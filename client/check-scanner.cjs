const ts = require('typescript');
const fs = require('fs');
const src = fs.readFileSync('src/editor/equations/parser.ts', 'utf8');
const sf = ts.createSourceFile('p.ts', src, ts.ScriptTarget.Latest, false);
const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, src);
const stack = [];
let tok;
const pairs = { '}': '{', ')': '(', ']': '[' };
while ((tok = sc.scan()) !== ts.SyntaxKind.EndOfFileToken) {
  const t = sc.getTokenText();
  const { line } = sf.getLineAndCharacterOfPosition(sc.getTokenStart());
  if (t === '{' || t === '(' || t === '[') stack.push({ ch: t, line: line + 1 });
  else if (t === '}' || t === ')' || t === ']') {
    const top = stack[stack.length - 1];
    if (top && top.ch === pairs[t]) stack.pop();
    else console.log('MISMATCH at line', line + 1, 'got', t, 'top', JSON.stringify(top));
  }
}
console.log('unclosed:', stack.map((s) => `${s.ch}@L${s.line}`).join(' ') || 'none');
