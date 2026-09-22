/**
 * TableRowResizing — Word-like table resize interactions.
 *
 * TWO floating handles, both managed at the DOCUMENT level (so hovering the
 * handles themselves and dragging outside the editor keep working):
 *
 *  1. ROW strip — hovering within ±6px of a row's BOTTOM border shows a
 *     grab strip centered exactly on the border (blue line + grip dot,
 *     cursor ns-resize). Dragging sets the row's `height` attribute —
 *     Word semantics: height is a MINIMUM, taller content still grows.
 *
 *  2. TABLE grip — hovering a table shows a corner square at the table's
 *     bottom-LEFT (the RTL end corner). Dragging horizontally resizes the
 *     WHOLE table (columns scale proportionally via the fixed layout) by
 *     updating the table's `width` attribute in percent (Word behavior).
 *
 * Screen deltas are divided by the page's real scale factor so zoomed
 * sheets resize in EDITOR pixels. Everything dispatches as normal
 * (undoable) transactions. One plugin instance per page editor; the
 * `view.dom.contains(target)` guard keeps only the editor under the mouse
 * showing handles.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const key = new PluginKey('tableRowResizing');

/** row resize limits + hit zone (editor px / screen px) */
const MIN_ROW_H = 28;
const HIT_PX = 6;

/** whole-table width limits (percent of the container) */
const MIN_TABLE_PCT = 15;
const MAX_TABLE_PCT = 100;

interface RowDrag {
  kind: 'row';
  rowPos: number;
  trEl: HTMLTableRowElement;
  startY: number;
  startHeight: number;
  scale: number;
  height: number;
}

interface TableDrag {
  kind: 'table';
  tablePos: number;
  tableEl: HTMLTableElement;
  startX: number;
  scale: number;
  startW: number;
  containerW: number;
}

export const TableRowResizing = Extension.create({
  name: 'tableRowResizing',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        view: (view: EditorView) => {
          const doc = view.dom.ownerDocument;

          /* the two floating handles — appended to view.dom's PARENT (the
             EditorContent wrapper), NOT inside the editable content:
             ProseMirror syncs view.dom's children with the document and
             would wipe foreign nodes there. */
          const rowStrip = doc.createElement('div');
          rowStrip.className = 'pn-row-resize-handle';
          rowStrip.contentEditable = 'false';

          const grip = doc.createElement('div');
          grip.className = 'pn-table-resize-grip';
          grip.contentEditable = 'false';

          view.dom.parentNode?.appendChild(rowStrip);
          view.dom.parentNode?.appendChild(grip);

          let drag: RowDrag | TableDrag | null = null;
          let hoverRow: HTMLTableRowElement | null = null;
          let hoverTable: HTMLTableElement | null = null;

          const scaleOf = (el: HTMLElement): number => {
            try {
              const r = el.getBoundingClientRect();
              return el.offsetHeight > 0 && r.height > 0 ? r.height / el.offsetHeight : 1;
            } catch {
              return 1;
            }
          };

          /* position a handle inside the offsetParent's coordinate space */
          const place = (el: HTMLElement, left: number, top: number, width?: number) => {
            const opRect = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect()
              ?? view.dom.getBoundingClientRect();
            el.style.left = `${Math.round(left - opRect.left)}px`;
            el.style.top = `${Math.round(top - opRect.top)}px`;
            if (width !== undefined) el.style.width = `${Math.round(width)}px`;
          };

          const showRowStrip = (trEl: HTMLTableRowElement) => {
            const r = trEl.getBoundingClientRect();
            place(rowStrip, r.left, r.bottom - HIT_PX, r.width);
            rowStrip.classList.add('pn-row-resize-handle--on');
          };

          const showGrip = (tableEl: HTMLTableElement) => {
            const r = tableEl.getBoundingClientRect();
            /* RTL: the table's end corner is bottom-LEFT — Word's RTL grip */
            place(grip, r.left - 5, r.bottom - 9);
            grip.classList.add('pn-table-resize-grip--on');
          };

          const hideAll = () => {
            hoverRow = null;
            hoverTable = null;
            rowStrip.classList.remove('pn-row-resize-handle--on');
            grip.classList.remove('pn-table-resize-grip--on');
          };

          const rowPosOf = (trEl: HTMLTableRowElement): number | null => {
            try {
              const pos = view.posAtDOM(trEl, 0);
              const $pos = view.state.doc.resolve(pos);
              for (let d = $pos.depth; d > 0; d--) {
                if ($pos.node(d).type.name === 'tableRow') return $pos.before(d);
              }
            } catch { /* detached during redraw */ }
            return null;
          };

          const tablePosOf = (tableEl: HTMLTableElement): number | null => {
            try {
              const pos = view.posAtDOM(tableEl, 0);
              const $pos = view.state.doc.resolve(pos);
              for (let d = $pos.depth; d >= 0; d--) {
                if (d > 0 && $pos.node(d).type.name === 'table') return $pos.before(d);
              }
            } catch { /* detached */ }
            return null;
          };

          const onMove = (e: MouseEvent) => {
            if (drag) return;
            if (!view.editable) { hideAll(); return; }
            const target = e.target as HTMLElement | null;
            /* the handles live OUTSIDE view.dom — they must be checked
               BEFORE the contains() guard, or hovering the handle itself
               runs hideAll() and every drag dies before it starts */
            if (!target) { hideAll(); return; }
            if (target === rowStrip || target === grip) return;
            if (!view.dom.contains(target)) { hideAll(); return; }

            /* 1) row bottom border? (checked FIRST — it overlaps the grip zone) */
            const tr = target.closest('tr') as HTMLTableRowElement | null;
            if (tr && view.dom.contains(tr)) {
              const r = tr.getBoundingClientRect();
              if (e.clientY >= r.bottom - HIT_PX && e.clientY <= r.bottom + HIT_PX) {
                if (hoverRow !== tr) hoverRow = tr;
                hoverTable = tr.closest('table') as HTMLTableElement | null;
                showRowStrip(tr);
                grip.classList.remove('pn-table-resize-grip--on');
                return;
              }
              const prev = tr.previousElementSibling as HTMLTableRowElement | null;
              if (prev) {
                const pr = prev.getBoundingClientRect();
                if (e.clientY >= pr.bottom - HIT_PX && e.clientY <= pr.bottom + HIT_PX) {
                  hoverRow = prev;
                  hoverTable = tr.closest('table') as HTMLTableElement | null;
                  showRowStrip(prev);
                  grip.classList.remove('pn-table-resize-grip--on');
                  return;
                }
              }
            }

            hoverRow = null;
            rowStrip.classList.remove('pn-row-resize-handle--on');

            /* 2) inside a table → show the whole-table corner grip */
            const table = target.closest('table') as HTMLTableElement | null;
            if (table && view.dom.contains(table)) {
              hoverTable = table;
              showGrip(table);
              return;
            }
            hoverTable = null;
            grip.classList.remove('pn-table-resize-grip--on');
          };

          const onRowDown = (e: MouseEvent) => {
            if (!hoverRow) return;
            const rowPos = rowPosOf(hoverRow);
            if (rowPos == null) return;
            const row = view.state.doc.nodeAt(rowPos);
            if (!row || row.type.name !== 'tableRow') return;

            drag = {
              kind: 'row',
              rowPos,
              trEl: hoverRow,
              startY: e.clientY,
              startHeight: hoverRow.offsetHeight,
              scale: scaleOf(hoverRow.closest('table') as HTMLElement),
              height: row.attrs.height ?? hoverRow.offsetHeight,
            };
            rowStrip.classList.add('pn-row-resize-handle--drag');
            doc.body.style.cursor = 'ns-resize';
            doc.body.style.userSelect = 'none';
          };

          const onGripDown = (e: MouseEvent) => {
            if (!hoverTable) return;
            const tablePos = tablePosOf(hoverTable);
            if (tablePos == null) return;
            const tableNode = view.state.doc.nodeAt(tablePos);
            if (!tableNode || tableNode.type.name !== 'table') return;

            /* container = the table's layout parent (the PM content box) */
            const containerW = (hoverTable.parentElement as HTMLElement | null)?.clientWidth
              ?? hoverTable.offsetWidth;

            drag = {
              kind: 'table',
              tablePos,
              tableEl: hoverTable,
              startX: e.clientX,
              scale: scaleOf(hoverTable),
              startW: hoverTable.getBoundingClientRect().width,
              containerW: containerW || 1,
            };
            grip.classList.add('pn-table-resize-grip--drag');
            doc.body.style.cursor = 'nwse-resize';
            doc.body.style.userSelect = 'none';
          };

          const onDragMove = (e: MouseEvent) => {
            if (!drag) return;
            e.preventDefault();

            if (drag.kind === 'row') {
              const delta = (e.clientY - drag.startY) / (drag.scale || 1);
              const next = Math.max(MIN_ROW_H, Math.round(drag.startHeight + delta));
              if (next === drag.height) return;
              drag.height = next;
              const row = view.state.doc.nodeAt(drag.rowPos);
              if (!row) return;
              view.dispatch(
                view.state.tr.setNodeMarkup(drag.rowPos, null, { ...row.attrs, height: next }),
              );
              return;
            }

            /* whole table: RTL drag direction is mirrored — moving the grip
               LEFT grows the table in an RTL layout */
            const scale = drag.scale || 1;
            const dx = (drag.startX - e.clientX) * scale; /* RTL: left = grow */
            const targetW = Math.max(60, drag.startW + dx);
            const pct = Math.round(Math.min(MAX_TABLE_PCT, Math.max(MIN_TABLE_PCT, (targetW / drag.containerW) * 100)));
            const width = pct >= MAX_TABLE_PCT ? null : `${pct}%`;
            const tableNode = view.state.doc.nodeAt(drag.tablePos);
            if (!tableNode) return;
            const current = tableNode.attrs.width as string | null;
            if (current === width) return;
            view.dispatch(
              view.state.tr.setNodeMarkup(drag.tablePos, null, { ...tableNode.attrs, width }),
            );
          };

          const onUp = () => {
            if (!drag) return;
            drag = null;
            rowStrip.classList.remove('pn-row-resize-handle--drag');
            grip.classList.remove('pn-table-resize-grip--drag');
            doc.body.style.cursor = '';
            doc.body.style.userSelect = '';
          };

          const onDown = (e: MouseEvent) => {
            if (!view.editable) return;
            /* capture-phase + direct target check: starting a drag must not
               depend on a prior hover. The handles are hidden for the
               elementFromPoint probe so it sees the table row underneath. */
            const target = e.target as HTMLElement | null;
            if (target !== rowStrip && target !== grip) return;
            e.preventDefault(); e.stopPropagation();
            const probe = (el: HTMLElement) => {
              el.style.display = 'none';
              const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
              el.style.display = '';
              return hit;
            };
            if (target === rowStrip) {
              const tr = probe(rowStrip)?.closest('tr') as HTMLTableRowElement | null;
              hoverRow = tr;
              onRowDown(e);
            } else {
              hoverTable = probe(grip)?.closest('table') as HTMLTableElement | null;
              onGripDown(e);
            }
          };

          /* capture-phase down: the strips sit beside the editable content and
             PM must never see the mousedown (it would move the caret) */
          doc.addEventListener('mousedown', onDown, true);
          doc.addEventListener('mousemove', onMove);
          doc.addEventListener('mousemove', onDragMove);
          doc.addEventListener('mouseup', onUp);
          view.dom.addEventListener('mouseleave', () => { if (!drag) hideAll(); });

          return {
            update: () => {
              /* keep the active handle glued across PM redraws */
              if (drag?.kind === 'row') {
                const r = drag.trEl.getBoundingClientRect();
                if (drag.trEl.isConnected) place(rowStrip, r.left, r.bottom - HIT_PX, r.width);
              } else if (drag?.kind === 'table' && drag.tableEl.isConnected) {
                const r = drag.tableEl.getBoundingClientRect();
                place(grip, r.left - 5, r.bottom - 9);
              } else if (hoverRow?.isConnected) showRowStrip(hoverRow);
              else if (hoverTable?.isConnected && !hoverRow) showGrip(hoverTable);
              else hideAll();
            },
            destroy: () => {
              doc.removeEventListener('mousedown', onDown, true);
              doc.removeEventListener('mousemove', onMove);
              doc.removeEventListener('mousemove', onDragMove);
              doc.removeEventListener('mouseup', onUp);
              rowStrip.remove();
              grip.remove();
              doc.body.style.cursor = '';
              doc.body.style.userSelect = '';
            },
          };
        },
      }),
    ];
  },
});
