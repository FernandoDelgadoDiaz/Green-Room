// Past appearances on public record that a show's RSS feed does not carry: older than the feed's
// oldest item, or a guest who is not named in the episode title (a call-in, a panel). Each entry cites
// a public source (data/catalog/known-past-guests.json). Used only to never propose a past guest again.

import type { Episode } from './types';
import known from '../data/catalog/known-past-guests.json';

interface KnownAppearance {
  name: string;
  published: string;
  title: string;
  url: string;
  evidence: string;
}

const BY_SHOW = known as unknown as Record<string, KnownAppearance[] | string>;

/** The show's known past appearances, shaped as episodes with one guest each. */
export function knownPastEpisodes(showId: string): Episode[] {
  const list = BY_SHOW[showId];
  if (!Array.isArray(list)) return [];
  return list.map((a, i) => ({
    id: `public-record-${i}`,
    title: a.title,
    published: new Date(`${a.published}T12:00:00Z`).toISOString(),
    url: a.url,
    guests: [{ name: a.name, method: 'public-record', confidence: 'high' }],
    excluded: false,
  }));
}
