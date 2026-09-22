import { useMemo } from 'react';

/**
 * BotAvatar — deterministic fallback avatars for users who have not uploaded
 * a picture. A set of DISTINCT abstract robot profiles — genderless, no
 * external images, each with its own face geometry + palette so members of
 * a group never look identical. «حالت پیش‌فرض» keeps the legacy behaviour
 * (the name is hashed to a stable pick); the user can also CHOOSE a fixed
 * profile from Settings → ظاهر و تجربه (settings.avatarPreset).
 */

export interface BotProfile {
  id: string;
  label: string;
  bg: string;
  ink: string;
}

export const BOT_PROFILES: BotProfile[] = [
  { id: 'auto', label: 'پیش‌فرض (بر اساس نام)', bg: '', ink: '' },
  { id: 'teal', label: 'فیروزه‌ای', bg: '#0f766e', ink: '#ffffff' },
  { id: 'blue', label: 'آبی', bg: '#1d4ed8', ink: '#ffffff' },
  { id: 'violet', label: 'بنفش', bg: '#7c3aed', ink: '#ffffff' },
  { id: 'amber', label: 'کهربایی', bg: '#b45309', ink: '#ffffff' },
  { id: 'rose', label: 'سرخابی', bg: '#be123c', ink: '#ffffff' },
  { id: 'slate', label: 'ذغالی', bg: '#374151', ink: '#ffffff' },
  { id: 'emerald', label: 'زمردی', bg: '#047857', ink: '#ffffff' },
];

/** name → stable palette (legacy «auto» behaviour) */
export function botAvatarFor(name?: string | null): { bg: string; ink: string } {
  const key = (name ?? '').trim();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const solid = BOT_PROFILES.filter((p) => p.id !== 'auto');
  return solid[h % solid.length];
}

/** resolve the profile the user chose ('auto' → name-hash), falling back
 *  gracefully when the stored id no longer exists */
export function resolveBotProfile(preset: string | undefined | null, name?: string | null): BotProfile {
  const chosen = BOT_PROFILES.find((p) => p.id === preset && p.id !== 'auto');
  if (chosen) return chosen;
  const auto = botAvatarFor(name);
  return { id: 'auto', label: 'پیش‌فرض', bg: auto.bg, ink: auto.ink };
}

/** deterministic face VARIANT per profile — each bot has its own geometry
 *  (eyes/visor/antenna) so the gallery reads as «ربات‌های متفاوت», not just
 *  recolored clones. The variant is derived from the profile id. */
function faceVariant(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return h % 4;
}

function Face({ variant, ink }: { variant: number; ink: string }) {
  if (variant === 0) {
    /* classic visor */
    return (
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" aria-hidden="true">
        <rect x="5" y="4" width="14" height="10" rx="5" fill={ink} opacity="0.16" />
        <circle cx="9.2" cy="9" r="1.4" fill={ink} />
        <circle cx="14.8" cy="9" r="1.4" fill={ink} />
        <rect x="8" y="16.5" width="8" height="1.6" rx="0.8" fill={ink} opacity="0.55" />
      </svg>
    );
  }
  if (variant === 1) {
    /* single wide eye + antenna */
    return (
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" aria-hidden="true">
        <rect x="10.9" y="1.5" width="2.2" height="3" rx="1.1" fill={ink} opacity="0.55" />
        <circle cx="12" cy="9.5" r="4.4" fill={ink} opacity="0.16" />
        <circle cx="12" cy="9.5" r="1.9" fill={ink} />
        <rect x="8" y="16.5" width="8" height="1.6" rx="0.8" fill={ink} opacity="0.55" />
      </svg>
    );
  }
  if (variant === 2) {
    /* square visor + smile */
    return (
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" aria-hidden="true">
        <rect x="5.5" y="5" width="13" height="8.5" rx="2.5" fill={ink} opacity="0.16" />
        <rect x="8.2" y="8" width="2.4" height="2.4" rx="0.6" fill={ink} />
        <rect x="13.4" y="8" width="2.4" height="2.4" rx="0.6" fill={ink} />
        <path d="M9 16.8c1 .8 2 1.2 3 1.2s2-.4 3-1.2" stroke={ink} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      </svg>
    );
  }
  /* twin-antenna */
  return (
    <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" aria-hidden="true">
      <rect x="4.6" y="2.2" width="1.8" height="3.4" rx="0.9" fill={ink} opacity="0.5" />
      <rect x="17.6" y="2.2" width="1.8" height="3.4" rx="0.9" fill={ink} opacity="0.5" />
      <rect x="5.5" y="5.5" width="13" height="9" rx="4.5" fill={ink} opacity="0.16" />
      <circle cx="9.4" cy="10" r="1.2" fill={ink} />
      <circle cx="14.6" cy="10" r="1.2" fill={ink} />
      <rect x="9" y="17" width="6" height="1.4" rx="0.7" fill={ink} opacity="0.5" />
    </svg>
  );
}

export function BotAvatar({
  name,
  preset,
  className = '',
}: {
  name?: string | null;
  /** the user's chosen avatarPreset ('auto' = name-hash); unknown → auto */
  preset?: string | null;
  className?: string;
}) {
  const p = useMemo(() => resolveBotProfile(preset, name), [preset, name]);
  const variant = useMemo(() => faceVariant(p.id), [p.id]);
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{ background: p.bg }}
      role="img"
      aria-label={name ? `آواتار ${name}` : 'آواتار'}
    >
      <Face variant={variant} ink={p.ink} />
    </span>
  );
}
