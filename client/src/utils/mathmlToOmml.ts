/**
 * MathML → OMML (Office Math Markup Language) converter.
 *
 * The Word export (.doc HTML) must show equations the way the editor does —
 * KaTeX markup without its stylesheet turns into garbage in Word. Word's
 * native equation format is OMML (m:oMath), which Word reconstructs into a
 * real, editable equation when it opens the HTML. KaTeX can emit MathML
 * directly, so the pipeline is:  LaTeX → (KaTeX) MathML → (this) OMML.
 *
 * Coverage: the exact element set KaTeX 0.16 emits (mrow, mstyle, mi, mn, mo,
 * mtext, ms, mspace, mfrac, msqrt, mroot, msup, msub, msubsup, munder, mover,
 * munderover, mtable/mtr/mtd, menclose, mphantom, mpadded, maction,
 * semantics/annotation). Unknown elements degrade gracefully to their text
 * content — the output stays valid OMML no matter what arrives.
 */

const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** one Office math text run — `normal` renders upright (Word's m:nor) */
function run(text: string | null, normal = false): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  const rpr = normal ? '<m:rPr><m:nor/></m:rPr>' : '';
  return `<m:r>${rpr}<m:t xml:space="preserve">${esc(t)}</m:t></m:r>`;
}

function elementChildren(el: Element): Element[] {
  return Array.from(el.children);
}

function childrenOf(el: Element): string {
  return elementChildren(el)
    .map(convert)
    .join('');
}

/** accent glyphs KaTeX emits as the `over` child of <mover accent="true">
 *  → the char Word's m:chr expects (ASCII ^ and ~ become real accents) */
const ACCENT_CHARS: Record<string, string> = {
  '⃗': '\u20D7', // vec
  '^': '\u02C6', // KaTeX writes the ASCII caret for \hat
  'ˆ': '\u02C6',
  '~': '\u02DC', // \tilde
  '˜': '\u02DC',
  '‾': '\u00AF', // \bar / \overline
  '˙': '\u02D9', // \dot
  '¨': '\u00A8', // \ddot
  '˘': '\u02D8', // \breve
};

/** two-argument constructs (frac, scripts, limits): child 0 = base/num */
function pair(el: Element, tag: string, first: string, second: string): string {
  const [a, b] = elementChildren(el);
  return `<${tag}><${first}>${convert(a)}</${first}><${second}>${convert(b)}</${second}></${tag}>`;
}

function convert(el: Element): string {
  switch (el.tagName) {
    /* transparent groups — OMML flattens them */
    case 'math':
    case 'semantics':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'mphantom':
    case 'menclose':
    case 'merror':
    case 'maction':
      return childrenOf(el);

    /* source annotation — never rendered */
    case 'annotation':
      return '';

    /* terminal tokens */
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms': {
      const text = el.textContent ?? '';
      /* multi-letter identifiers are function names (sin, lim…) — upright;
         single letters keep Word's default math-italic styling */
      const normal = el.tagName === 'mtext' || (el.tagName === 'mi' && text.trim().length > 1);
      return run(text, normal);
    }
    case 'mspace':
      return '';

    case 'mfrac': {
      const [num, den] = elementChildren(el);
      return `<m:f><m:num>${convert(num)}</m:num><m:den>${convert(den)}</m:den></m:f>`;
    }

    case 'msqrt':
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${childrenOf(el)}</m:e></m:rad>`;

    case 'mroot': {
      const [deg, base] = elementChildren(el);
      return `<m:rad><m:deg>${convert(deg)}</m:deg><m:e>${convert(base)}</m:e></m:rad>`;
    }

    case 'msup':
      return pair(el, 'm:sSup', 'm:e', 'm:sup');
    case 'msub':
      return pair(el, 'm:sSub', 'm:e', 'm:sub');
    case 'msubsup': {
      const [base, sub, sup] = elementChildren(el);
      return `<m:sSubSup><m:e>${convert(base)}</m:e><m:sub>${convert(sub)}</m:sub><m:sup>${convert(sup)}</m:sup></m:sSubSup>`;
    }

    case 'munder':
      return pair(el, 'm:limLow', 'm:e', 'm:lim');

    case 'mover': {
      const [base, over] = elementChildren(el);
      const glyph = (over?.textContent ?? '').trim();
      const accentChar = el.getAttribute('accent') === 'true' ? ACCENT_CHARS[glyph] : undefined;
      if (accentChar) {
        return `<m:acc><m:accPr><m:chr m:val="${accentChar}"/></m:accPr><m:e>${convert(base)}</m:e></m:acc>`;
      }
      return `<m:limUpp><m:e>${convert(base)}</m:e><m:lim>${convert(over)}</m:lim></m:limUpp>`;
    }

    case 'munderover': {
      const [base, under, over] = elementChildren(el);
      /* Word has no single three-part limit — nest limLow inside limUpp
         (same nesting Word itself writes when round-tripping) */
      return (
        `<m:limLow><m:e>` +
        `<m:limUpp><m:e>${convert(base)}</m:e><m:lim>${convert(over)}</m:lim></m:limUpp>` +
        `</m:e><m:lim>${convert(under)}</m:lim></m:limLow>`
      );
    }

    case 'mtable': {
      const rows = elementChildren(el)
        .map(
          (tr) =>
            `<m:mr>${elementChildren(tr)
              .map((td) => `<m:e>${childrenOf(td)}</m:e>`)
              .join('')}</m:mr>`,
        )
        .join('');
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcJc m:val="center"/></m:mc></m:mcs></m:mPr>${rows}</m:m>`;
    }

    /* rare/legacy — flatten */
    case 'mfenced':
    case 'mprescripts':
    default:
      return childrenOf(el);
  }
}

/**
 * Convert a parsed `<math>` element into a complete OMML island.
 * Returns `<m:oMath xmlns:m="…">…</m:oMath>` — self-contained, with the
 * namespace declared on the island so Word resolves the m: prefix wherever
 * it is pasted.
 */
export function mathmlToOmml(mathEl: Element): string | null {
  const inner = childrenOf(mathEl);
  if (!inner) return null;
  return `<m:oMath xmlns:m="${OMML_NS}">${inner}</m:oMath>`;
}

export { OMML_NS };
