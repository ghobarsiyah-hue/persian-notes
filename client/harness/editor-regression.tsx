import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from '../src/store/AppProvider';
import EditorPage from '../src/pages/EditorPage';
import { TextSelection } from '@tiptap/pm/state';
import '../src/index.css';

const output: string[] = [];
const report = (ok: boolean, text: string) => {
  output.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
  document.getElementById('out')!.textContent = output.join('\n');
};
window.addEventListener('error', e => report(false, e.message));
window.addEventListener('unhandledrejection', e => report(false, String(e.reason)));
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const note = { _id: 'regression', title: 'Pagination regression', chapter: '', tags: [], favorite: false, content: { type: 'doc', content: [paragraph('شروع ')] }, html: '', updatedAt: new Date().toISOString() };
localStorage.setItem('pn_token', 'local-test');
window.fetch = async (input, init) => {
  const path = String(input);
  let data: unknown = {};
  if (path.includes('/auth/me')) data = { user: { _id: 'test', name: 'Test', email: 'test@example.invalid' } };
  else if (path.includes('/subjects')) data = { subjects: [] };
  else if (path.includes('/tags')) data = { tags: [] };
  else if (path.includes('/templates')) data = { templates: [] };
  else if (path.includes('/settings')) data = { settings: {} };
  else if (path.includes('/notes/')) data = { note: { ...note, ...(init?.body ? JSON.parse(String(init.body)) : {}) } };
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
createRoot(document.getElementById('root')!).render(<React.StrictMode><AppProvider><MemoryRouter initialEntries={['/editor/regression']}><Routes><Route path="/editor/:id" element={<EditorPage />} /></Routes></MemoryRouter></AppProvider></React.StrictMode>);
const wait = (ms = 150) => new Promise(r => setTimeout(r, ms));
const sheets = () => Array.from(document.querySelectorAll<HTMLElement>('.document-pages > [data-page-id]'));
const editors = () => sheets().map(p => (p.querySelector('.tiptap') as any)?.editor).filter(Boolean);
(async () => {
  for (let i = 0; i < 50 && !editors().length; i++) await wait();
  const ed = editors()[0];
  if (!ed) { report(false, 'real editor mounted'); return; }
  await document.fonts.ready;
  ed.commands.setTextSelection(ed.state.doc.content.size - 1);
  ed.view.focus();
  report(ed.isFocused, 'source editor has focus before typing');
  let expected = ed.state.doc.textContent;
  for (let i = 0; i < 100 && sheets().length < 2; i++) {
    const chunk = 'این متن آزمایشی برای عبور از انتهای برگه و ادامه در برگه بعدی است. '.repeat(2);
    expected += chunk;
    const active = editors().find(e => e.isFocused) || editors().find(e => e.isEditable);
    active.commands.insertContent(chunk);
    await wait(100);
  }
  await wait(800);
  report(sheets().length >= 2, `overflow creates a separate A4 page (${sheets().length})`);
  report(sheets().every(p => p.offsetHeight === 1123), `fixed A4 heights ${sheets().map(p => p.offsetHeight)}`);
  const actualText = editors().map(e => e.state.doc.textContent).join('');
  report(actualText === expected, `text preserved across break expected=${expected.length} actual=${actualText.length} firstMismatch=${Array.from(expected).findIndex((c, i) => c !== actualText[i])}`);
  const activeId = sheets().find(p => (p.querySelector('.tiptap') as any)?.editor?.isEditable)?.dataset.pageId;
  const activeEditor = sheets().find(p => p.dataset.pageId === activeId);
  const activeEl = activeEditor?.querySelector('.tiptap');
  report(!!activeEl && document.activeElement === activeEl, 'caret is inside the active editor');
  report(activeEditor === sheets()[sheets().length - 1], 'active page is the continuation page');
  const focus = editors().find(e => e.view.dom === document.activeElement) || activeEditor?.querySelector('.tiptap')?.editor;
  if (focus) {
    focus.commands.insertContent('ادامه');
    expected += 'ادامه';
    await wait();
    report(editors().map(e => e.state.doc.textContent).join('') === expected, 'typing continues at the exact destination caret');
  }
  const ids = sheets().map(p => p.dataset.pageId).join();
  await wait(1500);
  report(sheets().map(p => p.dataset.pageId).join() === ids, 'page identities remain stable while idle');
  report(editors().every(e => e.view.dom.offsetHeight <= e.view.dom.closest('.pn-editor-wrap').clientHeight + 4), 'content fits every writing area');
})().catch(e => report(false, e.stack || String(e)));
