import { useState } from 'react';
import type { GuestProfile } from '../../core/profiles';

const PALETTES = [
  ['#21473a', '#d6a23a'],
  ['#1e3a5f', '#7dd3fc'],
  ['#3b1f4a', '#f0abfc'],
  ['#4a2a1f', '#fdba74'],
  ['#1f3d2e', '#86efac'],
];

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function paletteFor(name: string): string[] {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

/** Real photo when a verified free-licensed one exists; otherwise (or if it fails to load) elegant initials. */
export function GuestAvatar({ name, profile, size = 'lg' }: { name: string; profile: GuestProfile | null | undefined; size?: 'lg' | 'sm' }) {
  const [failed, setFailed] = useState(false);
  const dim = size === 'lg' ? 'h-20 w-20 sm:h-24 sm:w-24' : 'h-10 w-10';
  const photo = profile?.photo;
  if (photo && !failed) {
    return (
      <img
        src={photo.thumbUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${dim} shrink-0 rounded-2xl object-cover object-top ring-1 ring-white/15 shadow-lg`}
      />
    );
  }
  const [bg, fg] = paletteFor(name);
  return (
    <div
      aria-label={name}
      className={`${dim} shrink-0 rounded-2xl ring-1 ring-white/15 shadow-lg flex items-center justify-center font-display ${size === 'lg' ? 'text-3xl' : 'text-base'}`}
      style={{ background: `radial-gradient(circle at 30% 20%, ${fg}33, transparent 60%), ${bg}`, color: fg }}
    >
      {initials(name)}
    </div>
  );
}
