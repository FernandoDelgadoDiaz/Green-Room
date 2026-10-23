import type { AgentResult } from '../core/agent/agent';
import type { BaselineComparison } from '../core/discovery';
import type { PodcastHit, ResolveResult } from '../core/podcasts/open-search';

export type { PodcastHit, ResolveResult };
export interface FeedAnalysisSummary {
  level: 'complete' | 'limited' | 'insufficient';
  reasons: Array<{ en: string; es: string }>;
  sources: string[];
  stats: { episodes: number; withGuestNames: number; coverage: number; last: string | null } | null;
}
import type { BacktestResult } from '../core/backtest';
import type { PodcastSource } from '../core/types';
import type { GuestProfile } from '../core/profiles';
import type catalogJson from '../data/catalog.json';

export type Catalog = typeof catalogJson;
export type CatalogShow = Catalog['shows'][number];

export type RecommendResult = AgentResult & {
  profiles: Record<string, GuestProfile | null>;
  /** LIVE only: the same analysis without Qloo, to show what Qloo added. */
  comparison: BaselineComparison | null;
  origin: CatalogShow['origin'] | null;
};

export interface ShowSummary {
  id: string;
  name: string;
  host: string;
  language: string;
  description: string;
  source: PodcastSource;
  episodeCount: number;
  withGuests: number;
  firstEpisode: string | null;
  lastEpisode: string | null;
  recent: Array<{ title: string; published: string; url: string | null; guests: string[] }>;
}

const TOKEN_KEY = 'greenroom.liveToken';

/** Private test token typed by the tester; kept in this tab only (sessionStorage), never bundled. */
export const liveToken = {
  get: (): string | null => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string | null) => {
    try {
      if (v) sessionStorage.setItem(TOKEN_KEY, v);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage unavailable: the private mode simply does not persist.
    }
  },
};

async function post<T>(path: '/api/agent' | '/api/live' | '/api/podcasts', body: unknown, token?: string): Promise<{ ok: boolean; status: number; json: T & { error?: string; reason?: string } }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function call<T>(body: unknown): Promise<T> {
  // With a private token, analyses go to /api/live; the public endpoint is always MOCK.
  const token = liveToken.get();
  const { ok, status, json } = await post<T>(token ? '/api/live' : '/api/agent', body, token ?? undefined);
  if (!ok) throw new Error(json?.error ?? `HTTP ${status}`);
  return json as T;
}

async function podcasts<T>(body: unknown): Promise<T> {
  const { ok, status, json } = await post<T>('/api/podcasts', body);
  if (!ok) throw new Error(json?.error ?? `HTTP ${status}`);
  return json as T;
}

export type LiveStatus = { state: 'live' } | { state: 'off'; reason?: string } | { state: 'denied' | 'unconfigured' | 'error'; message: string };

export const api = {
  shows: () => post<{ qlooMode: 'LIVE' | 'MOCK'; shows: ShowSummary[] }>('/api/agent', { action: 'shows' }).then((r) => {
    if (!r.ok) throw new Error(r.json?.error ?? `HTTP ${r.status}`);
    return r.json;
  }),
  catalog: () => post<Catalog>('/api/agent', { action: 'catalog' }).then((r) => {
    if (!r.ok) throw new Error(r.json?.error ?? `HTTP ${r.status}`);
    return r.json;
  }),
  recommend: (showId: string) => call<RecommendResult>({ action: 'recommend', showId, k: 5 }),
  searchPodcasts: (term: string, store?: string) => podcasts<{ hits: PodcastHit[] }>({ action: 'search', term, store }),
  resolveLink: (url: string) => podcasts<ResolveResult>({ action: 'resolve', url }),
  /** Analysis of a show outside the catalog: LIVE through the private endpoint when a token is active. */
  analyzeFeed: async (hit: PodcastHit) => {
    const body = { action: 'analyze', feedUrl: hit.feedUrl, appleUrl: hit.appleUrl, host: hit.publisher };
    const token = liveToken.get();
    const { ok, status, json } = await post<{ analysis: FeedAnalysisSummary; result: RecommendResult | null }>(token ? '/api/live' : '/api/podcasts', body, token ?? undefined);
    if (!ok) throw new Error(json?.error ?? `HTTP ${status}`);
    return json;
  },
  backtest: (showId: string, cutoff: string) => call<BacktestResult>({ action: 'backtest', showId, cutoff, horizonMonths: 24 }),
  liveStatus: async (token: string): Promise<LiveStatus> => {
    const r = await post<{ mode?: string }>('/api/live', { action: 'status' }, token).catch((e) => ({ ok: false, status: 0, json: { error: String(e) } as { error?: string; reason?: string } }));
    if (r.ok) return { state: 'live' };
    if (r.status === 403) return { state: 'off', reason: r.json.reason };
    if (r.status === 401) return { state: 'denied', message: r.json.error ?? '401' };
    if (r.status === 503) return { state: 'unconfigured', message: r.json.error ?? '503' };
    return { state: 'error', message: r.json.error ?? `HTTP ${r.status}` };
  },
};
