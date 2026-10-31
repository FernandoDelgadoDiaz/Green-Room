// Builds the five-country catalog (data/catalog.json) and one dataset per analyzable new show
// (data/podcasts/<id>.json) from:
//   - data/catalog/sources.json: Apple Podcasts chart positions + iTunes lookup metadata (official
//     public Apple endpoints, retrieved 2026-10-23), curated to interview/conversation formats;
//   - data/raw/catalog/<id>.xml: snapshots of each show's official RSS feed (gitignored).
// Usage: npm run catalog:build
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseFeed, type ParsedFeed } from '../core/feed';
import { extractGenericGuests } from '../core/extract-generic';
import type { Episode, PodcastDataset } from '../core/types';

interface Origin {
  country: string | null;
  status: 'verified' | 'unverified';
  basis: 'production' | 'host' | null;
  evidence: Array<{ url: string; quote: string }>;
  note?: string;
}

interface SourceShow {
  id: string;
  /** Apple Podcasts chart the show was taken from (null when added for its verified origin). Not its origin. */
  country: string | null;
  chartRank: number | null;
  alsoCharts?: Record<string, number>;
  appleId: number | null;
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
  /** Shows on Spotify with no public RSS: episodes come from the Spotify Web API (scripts/fetch-spotify.ts). */
  spotifyId?: string;
  spotifyMarket?: string;
  /** Which chart chartRank comes from (default Apple). */
  chartSource?: 'apple' | 'spotify';
  origin: Origin;
}

const src = JSON.parse(readFileSync('data/catalog/sources.json', 'utf8')) as { retrievedAt: string; originRule: string; originCheckedAt: string; charts: Record<string, { url: string; updated: string }>; shows: SourceShow[] };
const MAX_EPISODES = 500;
const NOW = new Date(`${src.retrievedAt}T12:00:00Z`);
const rerun = /\b(TOP RATED|BEST OF|Recomendado|Rebroadcast|Encore|REPLAY|Re-?release)\b/i;
const excluded = /\b(trailer|tr[aá]iler|teaser|avance|announcement|anuncio)\b/i;

/** A Spotify Web API snapshot in the shape parseFeed returns (dated episodes only). */
function spotifyFeed(path: string): ParsedFeed {
  const j = JSON.parse(readFileSync(path, 'utf8')) as { show: { description: string; languages: string[] }; episodes: Array<{ id: string; title: string; published: string | null; url: string }> };
  return {
    language: (j.show.languages[0] ?? 'es').slice(0, 2).toLowerCase(),
    description: j.show.description ?? '',
    items: j.episodes.filter((e) => e.published).slice(0, MAX_EPISODES).map((e) => ({ guid: e.id, title: e.title, published: e.published!, url: e.url })),
  } as ParsedFeed;
}

const out: unknown[] = [];
for (const s of src.shows) {
  // A new show enters the catalog only once its episodes have been read: an RSS snapshot
  // (scripts/fetch-rss.ts) or a Spotify one (scripts/fetch-spotify.ts). Shows explicitly marked
  // not analyzable are still listed, with the reason.
  if (!s.existing && !s.notAnalyzable && !existsSync(`data/raw/catalog/${s.id}.xml`) && !existsSync(`data/raw/catalog/${s.id}.spotify.json`) && !existsSync(`data/podcasts/${s.id}.json`)) {
    console.log(`${s.id.padEnd(22)} skipped: no snapshot yet`);
    continue;
  }
  let ds: PodcastDataset | null = null;
  const raw = `data/raw/catalog/${s.id}.xml`;
  const spotifyRaw = `data/raw/catalog/${s.id}.spotify.json`;
  const stored = `data/podcasts/${s.id}.json`;
  if (s.existing) ds = JSON.parse(readFileSync(stored, 'utf8'));
  // Snapshots are gitignored: where this run has none for a show (e.g. in CI), keep its stored dataset.
  else if (!existsSync(raw) && !existsSync(spotifyRaw) && existsSync(stored)) ds = JSON.parse(readFileSync(stored, 'utf8'));
  else if (!s.notAnalyzable && (existsSync(raw) || (s.spotifyId && existsSync(spotifyRaw)))) {
    // Every item is read: the most recent MAX_EPISODES are analyzed, the older ones only keep past guests
    // from being proposed again (a show like This Week in Startups has three times that many).
    const feed = existsSync(raw) ? parseFeed(readFileSync(raw, 'utf8'), Infinity) : spotifyFeed(spotifyRaw);
    const toEpisode = (it: ParsedFeed['items'][number]): Episode => {
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
    };
    const episodes = feed.items.slice(0, MAX_EPISODES).map(toEpisode);
    // Older items: only those that name a guest, without the fields the analysis uses.
    const olderEpisodes = feed.items.slice(MAX_EPISODES).map(toEpisode).filter((e) => !e.excluded && e.guests.length);
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
        retrievedVia: s.spotifyId && !existsSync(raw)
          ? 'Episode list from the official Spotify Web API (show has no public RSS feed); snapshot taken by the "Build catalog from Spotify" workflow'
          : 'Feed URL from the official Apple Podcasts lookup API; RSS snapshot fetched through a scraping service (the build container cannot reach feed hosts directly)',
        note: `Most recent ${MAX_EPISODES} items analyzed; older items (${feed.items.length - episodes.length}) are read only to exclude past guests. Guest names come from a generic, conservative title rule (core/extract-generic.ts, confidence "low"); a spot check of 36 extractions found 3 non-person phrases.`,
      },
      episodes,
      ...(olderEpisodes.length ? { olderEpisodes } : {}),
    };
    writeFileSync(`data/podcasts/${s.id}.json`, JSON.stringify(ds) + '\n');
  }
  // Spotify shows: artwork and episode count from the API snapshot when this run has one.
  const spotifyMeta = s.spotifyId && existsSync(spotifyRaw) ? (JSON.parse(readFileSync(spotifyRaw, 'utf8')).show as { total: number; artwork: string | null }) : null;
  const eps = ds?.episodes.filter((e) => !e.excluded) ?? [];
  const dates = eps.map((e) => e.published).filter(Boolean).sort();
  const withGuests = eps.filter((e) => e.guests.length).length;
  const coverage = eps.length ? withGuests / eps.length : 0;
  const last = dates[dates.length - 1] ?? s.lastRelease;
  const ageDays = (NOW.getTime() - new Date(last).getTime()) / 86400_000;
  let status: 'analyzable' | 'limited' | 'not_analyzable' = 'analyzable';
  let reason: string | null = null;
  if (s.notAnalyzable === 'inactive_solo') (status = 'not_analyzable'), (reason = 'inactive');
  else if (!ds) (status = 'not_analyzable'), (reason = 'feed_not_snapshotted');
  else if (coverage < 0.3) (status = 'limited'), (reason = 'few_guest_names');
  // A feed with no episode in the last year can still be analyzed, but the history is old: say so.
  else if (ageDays > 365) (status = 'limited'), (reason = 'feed_stale');
  out.push({
    id: s.id,
    name: s.name,
    host: s.host,
    artwork: spotifyMeta?.artwork ?? s.artwork,
    platform: s.spotifyId ? 'spotify' : 'apple',
    genre: s.genre,
    language: ds?.language ?? (s.origin.country === 'us' || s.origin.country === 'gb' || s.country === 'us' || s.country === 'gb' ? 'en' : 'es'),
    origin: s.origin,
    description: ds?.description ?? null,
    // Popularity only: a chart position never decides the country a show is listed under.
    charts: [...(s.country ? [{ country: s.country, rank: s.chartRank, source: s.chartSource ?? 'apple' }] : []), ...Object.entries(s.alsoCharts ?? {}).map(([country, rank]) => ({ country, rank, source: 'apple' }))],
    appleUrl: s.appleUrl,
    feedUrl: s.feedUrl,
    appleTrackCount: spotifyMeta?.total ?? s.trackCount,
    lastRelease: last,
    snapshot: ds ? { episodes: eps.length, withGuestNames: withGuests, coverage: Math.round(coverage * 100) / 100, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null } : null,
    status,
    statusReason: reason,
  });
  console.log(`${s.id.padEnd(22)} ${(s.origin.country ?? '??').padEnd(3)} ${status.padEnd(15)} eps=${String(eps.length).padStart(4)} guests=${Math.round(coverage * 100)}% last=${last.slice(0, 10)}`);
}
writeFileSync(
  'data/catalog.json',
  JSON.stringify({ retrievedAt: src.retrievedAt, originRule: src.originRule, originCheckedAt: src.originCheckedAt, charts: src.charts, countries: ['us', 'mx', 'gb', 'ar', 'es'], shows: out }, null, 1) + '\n',
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
