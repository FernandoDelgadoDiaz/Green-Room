// Open podcast search: find shows that are not in the catalog, by name or by link, and turn a
// public RSS feed into an analyzable dataset.
//
// Sources and what each one is used for:
//   - Apple Podcasts Search/Lookup API (itunes.apple.com): name search, Apple links, feed URLs.
//   - Spotify and YouTube oEmbed (public, no key): only the TITLE of a pasted link, used to search
//     Apple for the same show. The user picks the match; nothing is merged by name. No Spotify or
//     YouTube content is stored, analyzed or sent to any model.
//   - The show's own RSS feed: episode titles and dates (the analysis input).
// Availability in a store is never evidence of a show's country of origin.

import { parseFeed } from '../feed';
import { extractGenericGuests } from '../extract-generic';
import { nameKey } from '../names';
import type { Episode, PodcastDataset } from '../types';
import { UnsafeUrlError } from '../net/safe-fetch';

export type FetchJson = (url: string) => Promise<unknown>;
export type FetchText = (url: string) => Promise<{ url: string; status: number; contentType: string; text: string }>;

export interface OriginInfo {
  country: string | null;
  status: string;
  evidence?: Array<{ url: string; quote: string }>;
}

export interface PodcastHit {
  appleId: number | null;
  name: string;
  publisher: string;
  feedUrl: string | null;
  artwork: string | null;
  genre: string | null;
  episodeCount: number | null;
  lastRelease: string | null;
  appleUrl: string | null;
  /** Apple storefront that returned the result: availability, NOT origin. */
  store: string | null;
  /** Catalog id when this show is already in the curated catalog. */
  catalogId: string | null;
  origin: OriginInfo;
}

export interface ResolveResult {
  platform: 'apple' | 'spotify' | 'youtube' | 'rss' | 'unknown';
  status: 'resolved' | 'choose' | 'unresolved';
  note: string;
  noteEs: string;
  /** Title read from the link (Spotify/YouTube oEmbed), when any. */
  linkTitle?: string;
  hits: PodcastHit[];
}

export interface CatalogRef {
  id: string;
  appleUrl: string;
  feedUrl: string;
  origin: OriginInfo;
}

const appleIdOf = (url: string | null | undefined) => Number(/\/id(\d+)/.exec(url ?? '')?.[1] ?? NaN) || null;

export class OpenPodcastSearch {
  constructor(
    private readonly deps: { fetchJson: FetchJson; fetchText: FetchText; catalog: CatalogRef[] },
  ) {}

  private hit(r: Record<string, unknown>): PodcastHit {
    const appleId = typeof r.collectionId === 'number' ? r.collectionId : null;
    const feedUrl = typeof r.feedUrl === 'string' ? r.feedUrl : null;
    const cat = this.deps.catalog.find((c) => (appleId && appleIdOf(c.appleUrl) === appleId) || (feedUrl && c.feedUrl === feedUrl)) ?? null;
    return {
      appleId,
      name: String(r.collectionName ?? r.trackName ?? ''),
      publisher: String(r.artistName ?? ''),
      feedUrl,
      artwork: typeof r.artworkUrl600 === 'string' ? r.artworkUrl600 : null,
      genre: typeof r.primaryGenreName === 'string' ? r.primaryGenreName : null,
      episodeCount: typeof r.trackCount === 'number' ? r.trackCount : null,
      lastRelease: typeof r.releaseDate === 'string' ? r.releaseDate : null,
      appleUrl: typeof r.collectionViewUrl === 'string' ? r.collectionViewUrl.replace(/\?.*$/, '') : null,
      store: typeof r.country === 'string' ? r.country : null,
      catalogId: cat?.id ?? null,
      // Only the curated catalog carries verified origins; everything else is "origin not verified".
      origin: cat?.origin ?? { country: null, status: 'unverified' },
    };
  }

  /** Name search. `store` narrows the Apple storefront; results from other countries are not hidden by origin. */
  async searchByName(term: string, store?: string): Promise<PodcastHit[]> {
    const q = term.trim().slice(0, 100);
    if (q.length < 2) return [];
    const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=15&term=${encodeURIComponent(q)}${store && /^[a-z]{2}$/.test(store) ? `&country=${store}` : ''}`;
    const res = (await this.deps.fetchJson(url)) as { results?: Array<Record<string, unknown>> };
    return (res.results ?? []).filter((r) => r.kind === 'podcast' || r.wrapperType === 'track').map((r) => this.hit(r)).filter((h) => h.name);
  }

  async lookupApple(id: number): Promise<PodcastHit | null> {
    const res = (await this.deps.fetchJson(`https://itunes.apple.com/lookup?entity=podcast&id=${id}`)) as { results?: Array<Record<string, unknown>> };
    const r = res.results?.[0];
    return r ? this.hit(r) : null;
  }

  /** Identifies the platform of a pasted link and tries to reach a usable episode source. */
  async resolveLink(raw: string): Promise<ResolveResult> {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return { platform: 'unknown', status: 'unresolved', note: 'Not a valid link.', noteEs: 'No es un enlace válido.', hits: [] };
    }
    const host = url.hostname.toLowerCase();
    if (host === 'podcasts.apple.com' || host === 'itunes.apple.com') {
      const id = appleIdOf(url.pathname);
      const hit = id ? await this.lookupApple(id) : null;
      return hit
        ? { platform: 'apple', status: 'resolved', note: 'Apple Podcasts link resolved through Apple’s lookup API.', noteEs: 'Enlace de Apple Podcasts resuelto con la API de búsqueda de Apple.', hits: [hit] }
        : { platform: 'apple', status: 'unresolved', note: 'Apple did not return a podcast for this link.', noteEs: 'Apple no devolvió un podcast para este enlace.', hits: [] };
    }
    if (host === 'open.spotify.com') {
      if (!/^\/(intl-[a-z-]+\/)?(show|episode)\/[A-Za-z0-9]+/.test(url.pathname))
        return { platform: 'spotify', status: 'unresolved', note: 'Only Spotify show or episode links are supported.', noteEs: 'Solo se aceptan enlaces de programas o episodios de Spotify.', hits: [] };
      return this.byTitle('spotify', `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com${url.pathname}`)}`);
    }
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
      return this.byTitle('youtube', `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.toString())}`);
    }
    // Anything else: treat it as a direct RSS feed (fetched through the SSRF-safe client).
    try {
      const r = await this.deps.fetchText(url.toString());
      if (r.status >= 400) return { platform: 'rss', status: 'unresolved', note: `The link answered HTTP ${r.status}.`, noteEs: `El enlace respondió HTTP ${r.status}.`, hits: [] };
      if (!/<rss[\s>]/i.test(r.text.slice(0, 5000))) return { platform: 'unknown', status: 'unresolved', note: 'The link is not an RSS feed and is not an Apple, Spotify or YouTube link.', noteEs: 'El enlace no es un RSS ni un enlace de Apple, Spotify o YouTube.', hits: [] };
      const feed = parseFeed(r.text, 1);
      const cat = this.deps.catalog.find((c) => c.feedUrl === r.url || c.feedUrl === url.toString()) ?? null;
      return {
        platform: 'rss',
        status: 'resolved',
        note: 'Direct RSS feed.',
        noteEs: 'Feed RSS directo.',
        hits: [{ appleId: null, name: feed.title || url.hostname, publisher: feed.author, feedUrl: r.url, artwork: null, genre: null, episodeCount: null, lastRelease: feed.items[0]?.published ?? null, appleUrl: null, store: null, catalogId: cat?.id ?? null, origin: cat?.origin ?? { country: null, status: 'unverified' } }],
      };
    } catch (err) {
      const msg = err instanceof UnsafeUrlError ? err.message : 'Could not fetch the link.';
      return { platform: 'unknown', status: 'unresolved', note: msg, noteEs: err instanceof UnsafeUrlError ? `Enlace rechazado: ${err.message}` : 'No se pudo leer el enlace.', hits: [] };
    }
  }

  /** Spotify/YouTube: read the title through oEmbed, search Apple for it, and let the user choose. */
  private async byTitle(platform: 'spotify' | 'youtube', oembedUrl: string): Promise<ResolveResult> {
    let title = '';
    let author = '';
    try {
      const o = (await this.deps.fetchJson(oembedUrl)) as { title?: string; author_name?: string };
      title = (o.title ?? '').trim();
      author = (o.author_name ?? '').trim();
    } catch {
      // fall through
    }
    if (!title)
      return { platform, status: 'unresolved', note: `The ${platform} link could not be read (private, removed or not a show).`, noteEs: `No se pudo leer el enlace de ${platform} (privado, eliminado o no es un programa).`, hits: [] };
    const queries = [...new Set([title, author].filter((x) => x.length > 2))].slice(0, 2);
    const seen = new Set<number>();
    const hits: PodcastHit[] = [];
    for (const q of queries) for (const h of await this.searchByName(q)) if (h.appleId && !seen.has(h.appleId)) (seen.add(h.appleId), hits.push(h));
    const exact = hits.filter((h) => nameKey(h.name) === nameKey(title));
    return {
      platform,
      status: hits.length ? 'choose' : 'unresolved',
      linkTitle: title,
      note: hits.length
        ? `${platform === 'spotify' ? 'Spotify' : 'YouTube'} does not offer this show's episode list to us; we searched Apple Podcasts for “${title}”. Choose the same show: we do not merge shows by name.`
        : `No public RSS source found for “${title}”. The link is kept as a reference only.`,
      noteEs: hits.length
        ? `${platform === 'spotify' ? 'Spotify' : 'YouTube'} no nos ofrece la lista de episodios; buscamos “${title}” en Apple Podcasts. Elegí el mismo programa: no fusionamos programas por nombre.`
        : `No encontramos una fuente RSS pública para “${title}”. El enlace queda solo como referencia.`,
      hits: [...exact, ...hits.filter((h) => !exact.includes(h))].slice(0, 8),
    };
  }
}

// ------------------------------------------------------------------ feed → dataset
export type AnalysisLevel = 'complete' | 'limited' | 'insufficient';

export interface FeedAnalysis {
  level: AnalysisLevel;
  reasons: Array<{ en: string; es: string }>;
  sources: string[];
  dataset: PodcastDataset | null;
  stats: { episodes: number; withGuestNames: number; coverage: number; last: string | null };
}

const EXCLUDED = /\b(trailer|tr[aá]iler|teaser|avance|announcement|anuncio)\b/i;
const RERUN = /\b(TOP RATED|BEST OF|Recomendado|Rebroadcast|Encore|REPLAY|Re-?release)\b/i;

/** Builds an analyzable dataset from a feed's XML and says how far the analysis can go, and why. */
export function analyzeFeedXml(xml: string, meta: { feedUrl: string; appleUrl?: string | null; host?: string | null; now?: Date }): FeedAnalysis {
  const now = meta.now ?? new Date();
  const sources = [meta.feedUrl, ...(meta.appleUrl ? [meta.appleUrl] : [])];
  let feed;
  try {
    feed = parseFeed(xml, Infinity);
  } catch {
    return { level: 'insufficient', reasons: [{ en: 'The feed could not be parsed as RSS.', es: 'El feed no se pudo leer como RSS.' }], sources, dataset: null, stats: { episodes: 0, withGuestNames: 0, coverage: 0, last: null } };
  }
  const hostAliases = [meta.host, feed.author].filter((x): x is string => Boolean(x && x.trim())).map((x) => x.trim());
  const toEpisode = (it: (typeof feed.items)[number]): Episode => {
    const ex = EXCLUDED.test(it.title);
    return {
      id: it.guid,
      title: it.title,
      published: it.published,
      url: it.url,
      guests: ex ? [] : extractGenericGuests(it.title, hostAliases, feed.title),
      excluded: ex,
      ...(ex ? { excludedReason: 'Trailer or announcement' } : {}),
      ...(RERUN.test(it.title) ? { rerun: true } : {}),
    };
  };
  // The 300 most recent items are analyzed; older ones only keep past guests from being proposed again.
  const episodes = feed.items.slice(0, 300).map(toEpisode);
  const olderEpisodes = feed.items.slice(300).map(toEpisode).filter((e) => !e.excluded && e.guests.length);
  const eps = episodes.filter((e) => !e.excluded && e.published);
  const withGuests = eps.filter((e) => e.guests.length).length;
  const coverage = eps.length ? withGuests / eps.length : 0;
  const last = eps.map((e) => e.published).sort().pop() ?? null;
  const reasons: FeedAnalysis['reasons'] = [];
  let level: AnalysisLevel = 'complete';
  if (eps.length < 5) {
    level = 'insufficient';
    reasons.push({ en: `Only ${eps.length} dated episodes in the feed.`, es: `Solo ${eps.length} episodios con fecha en el feed.` });
  } else if (withGuests < 3) {
    level = 'insufficient';
    reasons.push({ en: `Guest names could be read in only ${withGuests} episode titles: the show may not be an interview format, or its titles do not name guests.`, es: `Solo se pudieron leer nombres de invitados en ${withGuests} títulos: puede que no sea un formato de entrevistas o que los títulos no nombren a los invitados.` });
  } else {
    if (coverage < 0.3) ((level = 'limited'), reasons.push({ en: `Guest names in only ${Math.round(coverage * 100)}% of titles: repeat-guest checks may miss people.`, es: `Nombres de invitados en solo el ${Math.round(coverage * 100)}% de los títulos: el control de repetidos puede fallar.` }));
    if (last && (now.getTime() - new Date(last).getTime()) / 86400_000 > 365) ((level = 'limited'), reasons.push({ en: `No episode in the last year (last: ${last.slice(0, 10)}).`, es: `Sin episodios en el último año (último: ${last.slice(0, 10)}).` }));
  }
  if (feed.items.length > 300) reasons.push({ en: `The 300 most recent episodes were analyzed; the ${feed.items.length - 300} older ones were read only to rule out past guests.`, es: `Se analizaron los 300 episodios más recientes; los ${feed.items.length - 300} anteriores se leyeron solo para descartar invitados anteriores.` });
  const language = feed.language && feed.language !== 'und' ? feed.language : '';
  if (!language) reasons.push({ en: 'The feed does not declare a language.', es: 'El feed no declara un idioma.' });
  const id = `feed-${nameKey(feed.title || meta.feedUrl).replace(/\s+/g, '-').slice(0, 40) || 'show'}`;
  const dataset: PodcastDataset | null =
    level === 'insufficient'
      ? null
      : {
          id,
          name: feed.title || meta.feedUrl,
          host: hostAliases[0] ?? '',
          hostAliases,
          language,
          description: feed.description.slice(0, 220),
          source: { feedUrl: meta.feedUrl, website: meta.appleUrl ?? meta.feedUrl, retrievedAt: now.toISOString().slice(0, 10), retrievedVia: 'Live RSS fetch (open search)', note: 'Guest names from a generic title rule (confidence "low").' },
          episodes,
          ...(olderEpisodes.length ? { olderEpisodes } : {}),
        };
  return { level, reasons, sources, dataset, stats: { episodes: eps.length, withGuestNames: withGuests, coverage: Math.round(coverage * 100) / 100, last } };
}
