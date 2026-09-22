import { useMemo } from 'react';
import { botAvatarFor } from '@/components/BotAvatar';

/**
 * Group avatar — data-URL image when the group has one, otherwise a
 * deterministic two-tone tile from the SAME palette as user fallbacks so
 * the identity system stays coherent. Same name ⇒ same look everywhere.
 */
export function GroupAvatar({
  name,
  avatar,
  className = 'h-10 w-10',
  rounded = 'rounded-xl',
}: {
  name: string;
  avatar?: string | null;
  className?: string;
  rounded?: string;
}) {
  const p = useMemo(() => botAvatarFor(`group:${name}`), [name]);
  if (avatar) {
    return <img src={avatar} alt="" className={`shrink-0 object-cover ${rounded} ${className}`} />;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden font-bold ${rounded} ${className}`}
      style={{ background: p.bg, color: p.ink }}
      role="img"
      aria-label={`آواتار گروه ${name}`}
    >
      {name.trim().slice(0, 2) || 'گ'}
    </span>
  );
}
