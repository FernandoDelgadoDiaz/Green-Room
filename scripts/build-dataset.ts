// Builds data/podcasts/<id>.json from each show's official public RSS feed.
//
// Usage: npm run data:build            (uses data/raw/<id>.xml snapshots if present, else fetches the feed)
//
// Only derived, minimal fields are written (title, date, link, extracted guest names). Full episode
// descriptions are third-party content and stay out of the repository (data/raw/ is gitignored).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import type { Episode, GuestMention, PodcastDataset } from '../core/types';
import {
  creativoExclusion,
  doacExclusion,
  extractCreativoGuests,
  extractDoacGuests,
  extractLexGuests,
  isCreativoRerun,
} from '../core/extract';

interface ShowConfig {
  id: string;
  name: string;
  host: string;
  hostAliases: string[];
  language: string;
  description: string;
  feedUrl: string;
  website: string;
  feedDiscoveredVia: string;
  extract: (title: string, description: string) => GuestMention[];
  isRerun?: (title: string) => boolean;
  exclude: (title: string) => string | null;
  /** Manual corrections, each with a reason that a reviewer can check against the episode title. */
  overrides?: Record<string, { guests: GuestMention[]; reason: string }>;
}

const SHOWS: ShowConfig[] = [
  {
    id: 'lex-fridman',
    name: 'Lex Fridman Podcast',
    host: 'Lex Fridman',
    hostAliases: ['Lex Fridman'],
    language: 'en',
    description: 'Long-form conversations on technology, science, history, philosophy and culture.',
    feedUrl: 'https://lexfridman.com/feed/podcast/',
    website: 'https://lexfridman.com/podcast/',
    feedDiscoveredVia: 'Official feed linked from lexfridman.com',
    extract: extractLexGuests,
    exclude: () => null,
  },
  {
    id: 'diary-of-a-ceo',
    name: 'The Diary Of A CEO',
    host: 'Steven Bartlett',
    hostAliases: ['Steven Bartlett'],
    language: 'en',
    description: 'Interviews on business, psychology, health and personal development.',
    feedUrl: 'https://rss2.flightcast.com/xmsftuzjjykcmqwolaqn6mdn',
    website: 'https://stevenbartlett.com/doac/',
    feedDiscoveredVia: 'Feed URL listed on podnews.net/podcast/idte and podcastaddict.com',
    extract: (title) => extractDoacGuests(title),
    exclude: doacExclusion,
  },
  {
    id: 'creativo',
    name: 'CREATIVO',
    host: 'Roberto Mtz',
    hostAliases: ['Roberto Mtz', 'Roberto Martinez', 'Roberto Martínez'],
    language: 'es',
    description: 'Mexican interview podcast: music, comedy, sports, business and culture (Spanish).',
    feedUrl: 'https://anchor.fm/s/fdd14414/podcast/rss',
    website: 'https://robertomtz.com/',
    feedDiscoveredVia: 'Feed URL listed on podnews.net/podcast/i4ie8',
    extract: (title) => extractCreativoGuests(title),
    exclude: creativoExclusion,
    isRerun: isCreativoRerun,
    overrides: {
      'FRIDA KAHLO': { guests: [], reason: 'Biographical episode about Frida Kahlo (1907–1954); she is the subject, not a guest.' },
      'LEONARDO DA VINCI': { guests: [], reason: 'Biographical episode about Leonardo da Vinci; subject, not guest.' },
      'NIKOLA TESLA': { guests: [], reason: 'Biographical episode about Nikola Tesla (1856–1943); subject, not guest.' },
    },
  },
];

const RETRIEVED_AT = process.env.RETRIEVED_AT ?? '2026-10-22';

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text']);
  return '';
}

function cleanUrl(u: string): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k);
    return url.toString();
  } catch {
    return null;
  }
}

async function loadXml(cfg: ShowConfig): Promise<{ xml: string; via: string }> {
  const local = `data/raw/${cfg.id === 'lex-fridman' ? 'lex' : cfg.id === 'diary-of-a-ceo' ? 'doac' : 'creativo'}.xml`;
  if (existsSync(local)) return { xml: readFileSync(local, 'utf8'), via: `RSS snapshot (${local}) of ${cfg.feedUrl}` };
  const res = await fetch(cfg.feedUrl, { headers: { 'User-Agent': 'GreenRoom/0.1 (hackathon research; RSS reader)' } });
  if (!res.ok) throw new Error(`${cfg.feedUrl} -> HTTP ${res.status}`);
  return { xml: await res.text(), via: `Live fetch of ${cfg.feedUrl}` };
}

async function build(cfg: ShowConfig): Promise<PodcastDataset> {
  const { xml, via } = await loadXml(cfg);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: false });
  const doc = parser.parse(xml);
  const rawItems = doc?.rss?.channel?.item;
  const items: Record<string, unknown>[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  const episodes: Episode[] = items.map((it, idx) => {
    const title = decodeEntities(text(it.title)).replace(/\s+/g, ' ').trim();
    const description = decodeEntities(text(it.description) || text(it['content:encoded']));
    const pub = new Date(text(it.pubDate));
    const guid = text(it.guid) || `${cfg.id}-${idx}`;
    const nameSlot = title.replace(/^\d+\.\s*/, '').split(/\s+\|\s+/)[0].trim().toUpperCase();
    const override = cfg.overrides?.[nameSlot];
    const exclusion = cfg.exclude(title);
    let guests = exclusion ? [] : cfg.extract(title, description);
    if (override) guests = override.guests.map((g) => ({ ...g, method: 'manual-override' as const }));
    const hostKeys = cfg.hostAliases.map((h) => h.toLowerCase());
    guests = guests.filter((g) => !hostKeys.includes(g.name.toLowerCase()));
    return {
      id: guid,
      title,
      published: isNaN(pub.getTime()) ? '' : pub.toISOString(),
      url: cleanUrl(text(it.link)),
      guests,
      excluded: Boolean(exclusion) || Boolean(override && override.guests.length === 0),
      excludedReason: exclusion ?? override?.reason,
      ...(cfg.isRerun?.(title) ? { rerun: true } : {}),
    };
  });

  episodes.sort((a, b) => b.published.localeCompare(a.published));
  return {
    id: cfg.id,
    name: cfg.name,
    host: cfg.host,
    hostAliases: cfg.hostAliases,
    language: cfg.language,
    description: cfg.description,
    source: {
      feedUrl: cfg.feedUrl,
      website: cfg.website,
      retrievedAt: RETRIEVED_AT,
      retrievedVia: via,
      note: `${cfg.feedDiscoveredVia}. Guest names extracted by deterministic rules in core/extract.ts; episodes without a confident match keep an empty guest list.`,
    },
    episodes,
  };
}

for (const cfg of SHOWS) {
  const ds = await build(cfg);
  writeFileSync(`data/podcasts/${cfg.id}.json`, JSON.stringify(ds, null, 1) + '\n');
  const withGuests = ds.episodes.filter((e) => e.guests.length > 0).length;
  const excluded = ds.episodes.filter((e) => e.excluded).length;
  console.log(`${cfg.id}: ${ds.episodes.length} items, ${excluded} excluded, ${withGuests} with ≥1 guest`);
}
