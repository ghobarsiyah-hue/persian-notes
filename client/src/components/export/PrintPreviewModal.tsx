import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui';
import { useApp } from '@/store/AppProvider';
import { buildPagesHtml, type ExportPage } from '@/utils/pageModelExport';
import { printCss } from '@/utils/printCss';
import { PreviewBody } from './PreviewBody';
import { DEFAULT_BORDER_SETTINGS } from '@/types';
import type { BorderSettings } from '@/types';
import { resolveEduBlocks } from '@/utils/eduBlocks';

/** options that survive into the export — everything the editor already has */
export interface PageSettings {
  border: BorderSettings;
  /** document font size in px — the editor's own setting */
  fontSize: number;
  /** document line-height — the editor's own setting */
  lineHeight: number;
  /** «رنگی» edu-box style (settings.editor.eduBlocks === 'tinted') */
  eduTinted: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** final note HTML — kept for the Word export fallback (single-flow format) */
  html: string;
  /** the real page model: one ExportPage per editor page → one PDF page each */
  pages: ExportPage[];
  meta: { title: string; subject?: string; chapter?: string };
}

/**
 * Print preview: shows real A4 sheets using the page-model exporter.
 * Application Page N is exported as exactly one A4 PDF page N — a faithful
 * replica of the editable sheets, with no print-only options that could
 * distort the output.
 */
export function PrintPreviewModal({ open, onClose, html, pages, meta }: Props) {
  const { settings, toast } = useApp();

  /* Everything the export needs already lives on the document/editor — the
     modal is read-only and can no longer introduce print-only distortion. */
  const pageSettings = useMemo<PageSettings>(
    () => ({
      border: { ...DEFAULT_BORDER_SETTINGS, ...(settings?.border ?? {}) } as BorderSettings,
      fontSize: settings?.editor.fontSize ?? 16,
      lineHeight: settings?.editor.lineHeight ?? 2,
      fontFamily: settings?.editor.fontFamily,
      eduTinted: (settings?.editor.eduBlocks ?? 'minimal') === 'tinted',
      eduBlocks: resolveEduBlocks(settings?.editor.eduBlocks) ?? undefined,
    }),
    [settings?.border, settings?.editor.fontSize, settings?.editor.lineHeight, settings?.editor.fontFamily, settings?.editor.eduBlocks]
  );

  const [preview, setPreview] = useState<{ html: string; count: number }>({ html: '', count: 0 });

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      try {
        const { pagesHtml, pageCount } = buildPagesHtml(pages, meta, pageSettings);
        setPreview({ html: pagesHtml, count: pageCount });
      } catch (e) {
        toast('خطا در ساخت پیش‌نمایش: ' + (e as Error).message, 'error');
      }
    }, 50);
    return () => clearTimeout(t);
  }, [open, pages, meta, pageSettings, toast]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="پیش‌نمایش چاپ و خروجی PDF" wide>
      <style dangerouslySetInnerHTML={{ __html: printCss(pageSettings) }} />
      <PreviewBody html={html} pages={pages} meta={meta} pageSettings={pageSettings} preview={preview} />
    </Modal>
  );
}
