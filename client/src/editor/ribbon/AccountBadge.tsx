/**
 * AvatarBadge — the small presence dot used beside every user avatar.
 * Green = connected to the server, red = offline. Single visual system
 * across the settings page and the editor's AccountChip.
 */
export function AvatarBadge({ online, className = '' }: { online: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute rounded-full ring-2 ring-white dark:ring-[#1a1a1a] ${className} ${online ? 'bg-[#0070f3]' : 'bg-[#ff5b4f]'}`}
    />
  );
}
