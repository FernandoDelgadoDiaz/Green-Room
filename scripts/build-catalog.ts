// Builds the five-country catalog (data/catalog.json) and one dataset per analyzable new show
// (data/podcasts/<id>.json) from:
//   - data/catalog/sources.json: Apple Podcasts chart positions + iTunes lookup metadata (official
//     public Apple endpoints, retrieved 2026-10-23), curated to interview/conversation formats;
//   - data/raw/catalog/<id>.xml: snapshots of each show's official RSS feed (gitignored).
// Usage: npm run catalog:build
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseFeed } from '../core/feed';
import { extractGenericGuests } from '../core/extract-generic';
import type { Episode, PodcastDataset } from '../core/types';

interface SourceShow {
  id: string;
  country: string;
  chartRank: number | null;
  alsoCharts?: Record<string, number>;
  appleId: number;
  name: string;
  host: string;
  hostAliases: string[];
  brand: string;
  feedUrl: string;
  genre: string;
  trackCount: number;
  lastRelease: string;
  artwork: string;
  appleUrl: string;
  existing?: boolean;
  notAnalyzable?: 'feed_not_snapshotted' | 'inactive_solo';
}

const src = JSON.parse(readFileSync('data/catalog/sources.json', 'utf8')) as { retrievedAt: string; charts: Record<string, { url: string; updated: string }>; shows: SourceShow[] };
const MAX_EPISODES = 500;
const NOW = new Date(`${src.retrievedAt}T12:00:00Z`);
const rerun = /\b(TOP RATED|BEST OF|Recomendado|Rebroadcast|Encore|REPLAY|Re-?release)\b/i;
const excluded = /\b(trailer|tr[aá]iler|teaser|avance|announcement|anuncio)\b/i;

const out: unknown[] = [];
for (const s of src.shows) {
  let ds: PodcastDataset | null = null;
  const raw = `data/raw/catalog/${s.id}.xml`;
  if (s.existing) ds = JSON.parse(readFileSync(`data/podcasts/${s.id}.json`, 'utf8'));
  else if (!s.notAnalyzable && existsSync(raw)) {
    const feed = parseFeed(readFileSync(raw, 'utf8'), MAX_EPISODES);
    const episodes: Episode[] = feed.items.map((it) => {
      const ex = excluded.test(it.title);
      return {
        id: it.guid,
        title: it.title,
        published: it.published,
        url: it.url,
        guests: ex ? [] : extractGenericGuests(it.title, s.hostAliases, s.brand),
        excluded: ex,
        ...(ex ? { excludedReason: 'Trailer or announcement' } : {}),
        ...(rerun.test(it.title) ? { rerun: true } : {}),
      };
    });
    ds = {
      id: s.id,
      name: s.name,
      host: s.host,
      hostAliases: s.hostAliases,
      language: feed.language,
      description: feed.description.slice(0, 220).replace(/\s\S*$/, '') + (feed.description.length > 220 ? '…' : ''),
      source: {
        feedUrl: s.feedUrl,
        website: s.appleUrl,
        retrievedAt: src.retrievedAt,
        retrievedVia: 'Feed URL from the official Apple Podcasts lookup API; RSS snapshot fetched through a scraping service (the build container cannot reach feed hosts directly)',
        note: `Most recent ${MAX_EPISODES} items at most. Guest names come from a generic, conservative title rule (core/extract-generic.ts, confidence "low"); a spot check of 36 extractions found 3 non-person phrases.`,
      },
      episodes,
    };
    writeFileSync(`data/podcasts/${s.id}.json`, JSON.stringify(ds) + '\n');
  }
  const eps = ds?.episodes.filter((e) => !e.excluded) ?? [];
  const dates = eps.map((e) => e.published).filter(Boolean).sort();
  const withGuests = eps.filter((e) => e.guests.length).length;
  const coverage = eps.length ? withGuests / eps.length : 0;
  const last = dates[dates.length - 1] ?? s.lastRelease;
  const ageDays = (NOW.getTime() - new Date(last).getTime()) / 86400_000;
  let status: 'analyzable' | 'limited' | 'not_analyzable' = 'analyzable';
  let reason: string | null = null;
  if (s.notAnalyzable === 'inactive_solo' || ageDays > 365) (status = 'not_analyzable'), (reason = 'inactive');
  else if (!ds) (status = 'not_analyzable'), (reason = 'feed_not_snapshotted');
  else if (coverage < 0.3) (status = 'limited'), (reason = 'few_guest_names');
  out.push({
    id: s.id,
    name: s.name,
    host: s.host,
    artwork: s.artwork,
    genre: s.genre,
    language: ds?.language ?? (s.country === 'us' || s.country === 'gb' ? 'en' : 'es'),
    description: ds?.description ?? null,
    charts: [{ country: s.country, rank: s.chartRank }, ...Object.entries(s.alsoCharts ?? {}).map(([country, rank]) => ({ country, rank }))],
    appleUrl: s.appleUrl,
    feedUrl: s.feedUrl,
    appleTrackCount: s.trackCount,
    lastRelease: last,
    snapshot: ds ? { episodes: eps.length, withGuestNames: withGuests, coverage: Math.round(coverage * 100) / 100, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null } : null,
    status,
    statusReason: reason,
  });
  console.log(`${s.id.padEnd(22)} ${status.padEnd(15)} eps=${String(eps.length).padStart(4)} guests=${Math.round(coverage * 100)}% last=${last.slice(0, 10)}`);
}
writeFileSync(
  'data/catalog.json',
  JSON.stringify({ retrievedAt: src.retrievedAt, charts: src.charts, countries: ['us', 'mx', 'gb', 'ar', 'es'], shows: out }, null, 1) + '\n',
);

// Static imports so the Netlify Function bundles every dataset.
const ids = (out as Array<{ id: string }>).map((s) => s.id).filter((id) => existsSync(`data/podcasts/${id}.json`));
writeFileSync(
  'core/datasets.ts',
  [
    '// Generated by scripts/build-catalog.ts — static imports so the Netlify Function bundles every dataset.',
    "import type { PodcastDataset } from './types';",
    ...ids.map((id, i) => `import d${i} from '../data/podcasts/${id}.json';`),
    '',
    '/** Every analyzable show in the catalog (official RSS snapshots). */',
    `export const ALL_DATASETS: PodcastDataset[] = [${ids.map((_, i) => `d${i}`).join(', ')}] as PodcastDataset[];`,
    '',
    '/** The original three shows, kept as a fixed corpus for regression tests. */',
    "export const CORE_IDS = ['lex-fridman', 'diary-of-a-ceo', 'creativo'];",
    '',
  ].join('\n'),
);
