const ts = require('typescript');
const fs = require('fs');
const path = 'src/editor/equations/parser.ts';
const src = fs.readFileSync(path, 'utf8');
const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const diags = sf.parseDiagnostics;
console.log('diagnostics:', diags.length);
for (const d of diags.slice(0, 10)) {
  const { line, character } = sf.getLineAndCharacterOfPosition(d.start);
  console.log(`L${line + 1}:${character + 1}`, ts.flattenDiagnosticMessageText(d.messageText, ' '));
  const lines = src.split('\n');
  for (let i = Math.max(0, line - 3); i <= Math.min(lines.length - 1, line + 1); i++) {
    console.log(String(i + 1).padStart(4), lines[i]);
  }
}
