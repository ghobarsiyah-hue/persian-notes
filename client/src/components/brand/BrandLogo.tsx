/**
 * Brand marks — the three official logo variants shipped as PNG:
 *   LogoW.png → for WHITE backgrounds (light surfaces)
 *   LogoB.png → for BLACK backgrounds (dark surfaces)
 *   LogoT.png → transparent background (works on any surface, incl. glass)
 *
 * The T variant is the default everywhere: the app's surfaces are glass /
 * off-white in light mode and near-black in dark mode, and one transparent
 * mark reads correctly on both. Consumers who need a solid-backed variant
 * (e.g. favicon-style squares on pure white) can import LogoW/LogoB.
 *
 * Usage: <BrandLogo size={32} /> — falls back to the existing monogram "P"
 * tile if the asset fails to load, so the header never renders empty.
 */
import { useState } from 'react';

import logoT from '@/assets/brand/LogoT.png';
import logoW from '@/assets/brand/LogoW.png';
import logoB from '@/assets/brand/LogoB.png';

export type LogoVariant = 'auto' | 'white-bg' | 'black-bg';

export const LOGO_SOURCES: Record<Exclude<LogoVariant, 'auto'>, string> = {
  'white-bg': logoW,
  'black-bg': logoB,
};

export function getLogoSource(variant: LogoVariant): string {
  if (variant === 'auto') return logoT;
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
