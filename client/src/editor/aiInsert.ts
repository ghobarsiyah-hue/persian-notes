import type { Editor } from '@tiptap/core';
import type { AIActionId } from '@/types';

interface JSONNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JSONNode[];
  text?: string;
}

const para = (text: string): JSONNode => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
});

/**
 * Converts an AI text output into proper TipTap nodes so results become
 * *structured* note content instead of a wall of text:
 *  - "پرسش ::: پاسخ" lines   → فلش‌کارت (اصطلاح کلیدی)
 *  - "س: … / ج: …" pairs     → بلوک سوال
 *  - Markdown tables         → بلوک جدول واقعی
 *  - "#/##/###" headings     → تیتر
 *  - "- item" bullets        → فهرست
 */
export function aiOutputToNodes(action: AIActionId, output: string): JSONNode[] {
  const lines = output.split('\n').map((l) => l.trimEnd());

  // flashcards
  if (lines.filter((l) => l.includes(':::')).length >= 2 || (action === 'flashcards' && lines.some((l) => l.includes(':::')))) {
    const cards = lines.filter((l) => l.includes(':::')).map((l) => {
      const [q, ...rest] = l.split(':::');
      return {
        type: 'keyTermBlock',
        attrs: { term: q.replace(/^[-*]\s*/, '').trim() },
        content: [para(rest.join(':::').trim())],
      } as JSONNode;
    });
    return cards.length ? cards : [para(output)];
  }

  // question/answer pairs
  const qaNodes: JSONNode[] = [];
  let currentQ: string | null = null;
  const flushQ = () => {
    if (currentQ !== null) {
      qaNodes.push({ type: 'questionBlock', attrs: { question: currentQ }, content: [para('')] });
      currentQ = null;
    }
  };
  let collectingAnswer: JSONNode[] | null = null;
  for (const line of lines) {
    const qMatch = line.match(/^(?:[-*]\s*)?(?:س[وال]|سوٌال|سوال|س)\s*[:.)]\s*(.*)$/i);
    const aMatch = line.match(/^(?:[-*]\s*)?(?:ج[واب]|جواب|ج)\s*[:.)]\s*(.*)$/i);
    if (qMatch) {
      flushQ();
      currentQ = qMatch[1].trim();
      collectingAnswer = [];
    } else if (aMatch && collectingAnswer) {
      collectingAnswer.push(para(aMatch[1].trim()));
      qaNodes.push({ type: 'questionBlock', attrs: { question: currentQ ?? '' }, content: collectingAnswer });
      currentQ = null;
      collectingAnswer = null;
    } else if (line) {
      qaNodes.push(para(stripped(line)));
    }
  }
  flushQ();
  if (action === 'questions' && qaNodes.some((n) => n.type === 'questionBlock')) return qaNodes;

  // markdown table
  const tableLines = lines.filter((l) => l.trim().startsWith('|'));
  if (tableLines.length >= 2 && (action === 'table' || tableLines.length >= 3)) {
    const rows = tableLines
      .filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim()))
      .map((l) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
      );
    if (rows.length >= 2) {
      return [
        {
          type: 'table',
          content: rows.map((row, ri) => ({
            type: 'tableRow',
            content: row.map((cell) => ({
              type: ri === 0 ? 'tableHeader' : 'tableCell',
              attrs: { textAlign: 'right' },
              content: [para(cell)],
            })),
          })),
        } as JSONNode,
        /* «بعد از جدول یک خط پایین‌تر اسپیس بخوره»: WITHOUT this empty
           paragraph the AI table is the document's LAST block — no caret
           position exists below it, so the user is TRAPPED inside the last
           cell (typing Enter only adds rows INSIDE the table until the
           FixedPageGuard starts rejecting). The paragraph is the ordinary
           flowing text below the table the user continues in; it also
           guarantees insertContent's own trailing-paragraph handling never
           swallows the table itself. */
        para(''),
        para(''),
      ];
    }
  }

  // timeline: lines with «تاریخ: توضیح»
  const tlLines = lines.filter((l) => /^[^:]+:\s*.+/m.test(l));
  if ((action as string) === 'timeline' || (tlLines.length >= 2 && lines.some((l) => /^◷/.test(l)))) {
    const events = tlLines.length ? tlLines : lines;
    const json: JSONNode = {
      type: 'timeline',
      attrs: { title: 'زمان‌خط' },
      content: events.map((l) => ({ type: 'text', text: l.trim() })),
    };
    return [json, para('')];
  }

  // generic markdown-ish text
  const nodes: JSONNode[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length) {
      nodes.push({
        type: 'bulletList',
        content: bullets.map((b) => ({ type: 'listItem', content: [para(b)] })),
      } as JSONNode);
      bullets = [];
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      flushBullets();
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    const b = t.match(/^[-*•]\s+(.*)$/);
    if (h) {
      flushBullets();
      nodes.push({ type: 'heading', attrs: { level: h[1].length }, content: [{ type: 'text', text: h[2] }] });
    } else if (b) {
      bullets.push(b[1].replace(/\*\*(.+?)\*\*/g, '$1'));
    } else {
      flushBullets();
      nodes.push(para(stripped(t)));
    }
  }
  flushBullets();
  return nodes.length ? nodes : [para(output)];
}

function stripped(line: string): string {
  return line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/, '');
}

/** inserts AI output at the current position / replaces the selection */
export function insertAIOutput(editor: Editor, action: AIActionId, output: string, replaceSelection: boolean) {
  const nodes = aiOutputToNodes(action, output);
  let chain = editor.chain().focus();
  if (replaceSelection && !editor.state.selection.empty) chain = chain.deleteSelection();
  chain.insertContent(nodes).run();
}
