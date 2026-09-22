const ts = require('typescript');
const fs = require('fs');
const src = fs.readFileSync('src/editor/equations/parser.ts', 'utf8');
const lines = src.split('\n');

function diags(text) {
  const sf = ts.createSourceFile('p.ts', text, ts.ScriptTarget.Latest, false);
  return sf.parseDiagnostics.map((d) => {
    const { line } = sf.getLineAndCharacterOfPosition(d.start);
    return `L${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
}

for (const n of [60, 80, 100, 150, 200, 250, 280, 300, 320, 330, 340, 345, 350, 360, 370, 380, 386]) {
  const d = diags(lines.slice(0, n).join('\n'));
  if (d.length) console.log(`prefix ${n}:`, d.join(' | '));
  else console.log(`prefix ${n}: clean`);
}
