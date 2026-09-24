/**
 * Brand marks — the official logo assets shipped as PNG:
 *   LogoW.png → for WHITE backgrounds (light surfaces)
 *   LogoB.png → for BLACK backgrounds (dark surfaces)
 *   LogoT.png → transparent background (works on any surface, incl. glass)
 *   007.png   → the sidebar/navbar mark (user pick) — used for 'sidebar'
 *
 * The sidebar nav renders 007.png on BOTH themes: the glass panel keeps its
 * own readable background, so one mark works everywhere (item ۷).
 *
 * Usage: <BrandLogo size={32} /> — falls back to the existing monogram "P"
 * tile if the asset fails to load, so the header never renders empty.
 */
import { useState } from 'react';

import logoT from '@/assets/brand/LogoT.png';
import logoW from '@/assets/brand/LogoW.png';
import logoB from '@/assets/brand/LogoB.png';
import logo007 from '@/assets/brand/007.png';

export type LogoVariant = 'auto' | 'white-bg' | 'black-bg' | 'sidebar';

export const LOGO_SOURCES: Record<Exclude<LogoVariant, 'auto'>, string> = {
  'white-bg': logoW,
  'black-bg': logoB,
  sidebar: logo007,
};

export function getLogoSource(variant: LogoVariant): string {
  if (variant === 'auto') return logoT;
  if (variant === 'sidebar') return logo007;
  return LOGO_SOURCES[variant];
}

export function BrandLogo({ size = 32, variant = 'auto', className = '' }: { size?: number; variant?: LogoVariant; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    /* the monogram tile is the historical fallback mark — keep it pixel-
       compatible so the collapse toggle and auth screen stay stable */
    return (
      <span
        aria-hidden="true"
        className={`flex items-center justify-center rounded-lg bg-[#171717] text-xs font-bold text-white dark:bg-white dark:text-[#171717] ${className}`}
        style={{ width: size, height: size }}
      >
        P
      </span>
    );
  }
  return (
    <img
      src={getLogoSource(variant)}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={() => setFailed(true)}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}
