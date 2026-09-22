import type { ReactNode } from 'react';
import { BrandLogo } from '@/components/brand/BrandLogo';

/**
 * Shared chrome for the auth pages (Login / Sign up).
 * One narrow, calm column on the app background — no gradients, no glass,
 * no heavy cards. The logo mark intentionally mirrors the AppLayout mark
 * (rounded near-black square, white P) so the auth screen and the workspace
 * read as one product. Monochrome by design: color enters only through
 * the input focus states and the primary action.
 */
export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div
      className="pn-app-bg flex min-h-screen flex-col items-center justify-center px-4 py-10 dark:bg-ink-950"
      dir="rtl"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex justify-center rounded-2xl bg-[#0b0b0b] p-2 dark:bg-transparent">
            {/* black-background variant — the mark was drawn for a dark plate */}
            <BrandLogo size={56} variant="black-bg" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#171717] dark:text-white">
            پرشین‌نوت
          </h1>
          <p className="mt-1.5 text-sm text-[#666] dark:text-[#888]">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
