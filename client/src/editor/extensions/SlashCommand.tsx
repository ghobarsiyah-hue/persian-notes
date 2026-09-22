import { Extension } from '@tiptap/core';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import type { Editor, Range } from '@tiptap/core';
import { createSlashRenderer, type SlashItem } from './SlashMenu';
import { scaleToFit, insertionArea } from '../pageCapacity';
import { emitCapacityReject } from '../paginationMode';
import {
  Type, Heading1, Heading2, List, ListOrdered, CheckSquare, Quote,
  BookOpen, Star, AlertCircle, HelpCircle, CircleDot,
  Lightbulb, Minus, Code, Image, Table, Hash, FileText,
  Columns, Sigma, PenTool, CheckCircle, ListChecks,
} from 'lucide-react';

/** builds a callout-style educational block */
function callout(kind: string, title: string) {
  return (editor: Editor, range: Range) => {
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent({
        type: 'calloutBlock',
        attrs: { kind, title },
        content: [{ type: 'paragraph' }] as never,
      })
      .run();
  };
}

const icon = (node: React.ReactNode) => node;
export const SLASH_ITEMS: SlashItem[] = [
  // --- ساختار و متن ---
  { group: 'ساختار و متن', title: 'عنوان', icon: icon(<Heading1 className="h-5 w-5" />), keywords: ['heading', 'onvan', 'h1'], command: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 1 }).run() },
  { group: 'ساختار و متن', title: 'تیتر', icon: icon(<Heading2 className="h-5 w-5" />), keywords: ['heading', 'titr', 'h2'], command: (e, r) => e.chain().focus().deleteRange(r).setNode('heading', { level: 2 }).run() },
  { group: 'ساختار و متن', title: 'متن', icon: icon(<Type className="h-5 w-5" />), keywords: ['text', 'matn', 'paragraph'], command: (e, r) => e.chain().focus().deleteRange(r).setNode('paragraph').run() },
  { group: 'ساختار و متن', title: 'لیست', icon: icon(<List className="h-5 w-5" />), keywords: ['list', 'liste', 'bullet'], command: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { group: 'ساختار و متن', title: 'چک‌لیست', icon: icon(<CheckSquare className="h-5 w-5" />), keywords: ['checklist', 'task', 'chek'], command: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { group: 'ساختار و متن', title: 'نقل‌قول', icon: icon(<Quote className="h-5 w-5" />), keywords: ['quote', 'blockqoute'], command: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  // --- بلوک‌های آموزشی ---
  { group: 'بلوک‌های آموزشی', title: 'تعریف', icon: icon(<BookOpen className="h-5 w-5" />), keywords: ['definition', 'taarif'], command: callout('definition', 'تعریف') },
  { group: 'بلوک‌های آموزشی', title: 'نکته مهم', icon: icon(<Star className="h-5 w-5" />), keywords: ['important', 'noke', 'mohem'], command: callout('important', 'نکته مهم') },
  { group: 'بلوک‌های آموزشی', title: 'نکته امتحانی', icon: icon(<HelpCircle className="h-5 w-5" />), keywords: ['exam', 'emtehan'], command: callout('exam', 'نکته امتحانی') },
  { group: 'بلوک‌های آموزشی', title: 'توجه', icon: icon(<AlertCircle className="h-5 w-5" />), keywords: ['warning', 'tavajjoh'], command: callout('warning', 'توجه') },
  { group: 'بلوک‌های آموزشی', title: 'سوال', icon: icon(<HelpCircle className="h-5 w-5" />), keywords: ['question', 'soal'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'questionBlock', attrs: { question: '' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های آموزشی', title: 'مثال', icon: icon(<Lightbulb className="h-5 w-5" />), keywords: ['example', 'mesal'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'exampleBlock', attrs: { title: '' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های آموزشی', title: 'خلاصه', icon: icon(<CircleDot className="h-5 w-5" />), keywords: ['summary', 'kholase'], command: callout('summary', 'خلاصه') },
  { group: 'بلوک‌های آموزشی', title: 'اصطلاح کلیدی', icon: icon(<Hash className="h-5 w-5" />), keywords: ['keyterm', 'flashcard', 'estelah'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'keyTermBlock', attrs: { term: '' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های آموزشی', title: 'سوال تشریحی', icon: icon(<PenTool className="h-5 w-5" />), keywords: ['essay question', 'soal tashrihi', 'tashrihi'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'longAnswerBlock', attrs: { question: '', points: 0 }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های آموزشی', title: 'سوال درست / نادرست', icon: icon(<CheckCircle className="h-5 w-5" />), keywords: ['true false', 'sah ghalt', 'درست نادرست'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'trueFalseBlock', attrs: { question: '', answer: 'none' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های آموزشی', title: 'سوال چهارگزینه‌ای', icon: icon(<ListChecks className="h-5 w-5" />), keywords: ['mcq', 'test', 'gozine', 'چهارگزینه', 'تستی'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'mcqBlock', attrs: { qTitle: '', layout: 'stacked', options: ['', '', '', ''], correct: -1 }, content: [{ type: 'paragraph' }] }).run();
    } },
  // --- رسانه و فرمول ---
  { group: 'رسانه و فرمول', title: 'معادله', icon: icon(<Sigma className="h-5 w-5" />), keywords: ['equation', 'moadele', 'math', 'riazi'], command: (e, r) => {
      /* inline at the caret + auto-activate (Design tab opens) */
      e.chain().focus().deleteRange(r).insertEquation({ display: false }).run();
    } },
  { group: 'رسانه و فرمول', title: 'معادله نمایشی', icon: icon(<Sigma className="h-5 w-5" />), keywords: ['equation display', 'moadele', 'block'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertEquation({ display: true }).run();
    } },
  { group: 'رسانه و فرمول', title: 'فرمول (LaTeX)', icon: icon(<Sigma className="h-5 w-5" />), keywords: ['formula', 'math', 'latex'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'formulaBlock', content: [{ type: 'text', text: 'x^2 + y^2 = z^2' }] as never }).run();
    } },
  { group: 'رسانه و فرمول', title: 'مقایسه (جدول دو ستونه)', icon: icon(<Columns className="h-5 w-5" />), keywords: ['compare', 'moghayese', 'tadadol'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'comparisonTable', attrs: { leftLabel: 'بخش اول', rightLabel: 'بخش دوم' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'رسانه و فرمول', title: 'تصویر', icon: icon(<Image className="h-5 w-5" />), keywords: ['image', 'aks', 'picture'], command: (e, r) => {
      const url = window.prompt('آدرس (URL) تصویر را وارد کنید:');
      if (!url) return;
      /* scale-to-fit (ManualFixedPagePolicy §10): once the URL's natural
         size is known, insert at the largest proportional size that fits
         the page's remaining usable area — never cropped, never moved to
         another page. Too large even at minimum → safe rejection. */
      /* window.Image — the DOM constructor; `Image` here is the lucide icon */
      const img = new window.Image();
      img.onload = () => {
        const natW = img.naturalWidth || 600;
        const natH = img.naturalHeight || 400;
        const area = insertionArea(e.view);
        const fit = scaleToFit(natW, natH, area.width, area.height);
        if (!fit.fits) {
          emitCapacityReject('تصویر در فضای باقی‌مانده صفحه جا نمی‌شود');
          return;
        }
        /* width rides on the project's extended image attrs (Page.tsx) —
           setImage's stock signature doesn't know it, so insertContent */
        e.chain().focus().deleteRange(r).insertContent({ type: 'image', attrs: { src: url, width: fit.width } } as never).run();
      };
      /* unmeasurable URL — insert unsized; the page guard decides */
      img.onerror = () => e.chain().focus().deleteRange(r).setImage({ src: url }).run();
      img.src = url;
    } },
  { group: 'رسانه و فرمول', title: 'جدول', icon: icon(<Table className="h-5 w-5" />), keywords: ['table', 'jadval'], command: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { group: 'ساختار و متن', title: 'شکست صفحه', icon: icon(<Minus className="h-5 w-5" />), keywords: ['page break', 'shekast', 'new page', 'safe'], command: (e, r) => {
      /* MANUAL page break (§27): a hard boundary the user creates on
         purpose — the host consumes it into a real new page (no automatic
         pagination involved). */
      e.chain().focus().deleteRange(r).setPageBreak().run();
    } },
  { group: 'رسانه و فرمول', title: 'جداکننده', icon: icon(<Minus className="h-5 w-5" />), keywords: ['hr', 'jodakonande', 'separator'], command: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { group: 'رسانه و فرمول', title: 'کد', icon: icon(<Code className="h-5 w-5" />), keywords: ['code', 'kod'], command: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { group: 'بلوک‌های آموزشی', title: 'زمان‌خط', icon: icon(<PenTool className="h-5 w-5" />), keywords: ['timeline', 'rozhan', 'zaman'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'timeline', attrs: { title: 'زمان‌خط' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های آموزشی', title: 'یادداشت پاورقی', icon: icon(<FileText className="h-5 w-5" />), keywords: ['footnote', 'pavarki', 'hanz'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'footnoteBlock', attrs: { label: 'یادداشت پاورقی' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های آموزشی', title: 'پاسخ تشریحی', icon: icon(<PenTool className="h-5 w-5" />), keywords: ['longanswer', 'teshriri', 'savol'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'longAnswerBlock', attrs: { question: 'سوال تشریحی', points: 0 }, content: [{ type: 'paragraph' }] }).run();
    } },
  // --- بلوک‌های جدید ---
  { group: 'بلوک‌های جدید', title: 'جعبه برجسته', icon: icon(<CircleDot className="h-5 w-5" />), keywords: ['highlight', 'nokte', 'bozorge'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'highlightBox', attrs: { title: 'نکته برجسته', icon: '◉' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های جدید', title: 'منبع آکادمیک', icon: icon(<FileText className="h-5 w-5" />), keywords: ['reference', 'source', 'manba'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'referenceBlock', attrs: { authors: '', year: '', title: '', url: '' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های جدید', title: 'موافق و مخالف', icon: icon(<Columns className="h-5 w-5" />), keywords: ['procon', 'mofaghe', 'mokhalef', 'compare2'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'proConBlock', attrs: { topic: '' }, content: [{ type: 'paragraph' }] }).run();
    } },
  { group: 'بلوک‌های جدید', title: 'کد با خروجی', icon: icon(<Code className="h-5 w-5" />), keywords: ['codeoutput', 'code2', 'program'], command: (e, r) => {
      e.chain().focus().deleteRange(r).insertContent({ type: 'codeOutputBlock', attrs: { lang: '', label: 'کد و خروجی' }, content: [{ type: 'paragraph' }] }).run();
    } },
];

function filterItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (i) => i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q))
  );
}

/** slash ("/") command menu wired through TipTap suggestion */
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    const renderer = createSlashRenderer();
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: ({ query }) => filterItems(query),
        command: ({ editor, range, props }) => props.command(editor, range),
        render: () => ({
          onStart: (props: SuggestionProps) => renderer.onStart(props),
          onUpdate: (props: SuggestionProps) => renderer.onUpdate(props),
          onKeyDown: (props: SuggestionKeyDownProps) => renderer.onKeyDown(props),
          onExit: () => renderer.onExit(),
        }),
      }),
    ];
  },
});
