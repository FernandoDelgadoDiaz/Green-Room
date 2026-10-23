// Open podcast search endpoint (/api/podcasts): name search, link resolution and analysis of a
// show that is not in the catalog. Public and always MOCK for Qloo, like /api/agent.
// Every outbound request goes through the SSRF-safe client; API hosts are allow-listed and feeds
// must be public https URLs. Per request: at most 3 outbound calls; responses are cached.

import { CATALOG, DATASETS, ORIGIN_OF, recommendFor, type Env } from './api';
import { MockQlooAdapter } from './qloo/mock';
import type { QlooAdapter } from './qloo/types';
import { safeFetch, safeJson, UnsafeUrlError } from './net/safe-fetch';
import { analyzeFeedXml, OpenPodcastSearch, type CatalogRef } from './podcasts/open-search';

export type PodcastsRequest =
  | { action: 'search'; term: string; store?: string }
  | { action: 'resolve'; url: string }
  | { action: 'analyze'; feedUrl: string; appleUrl?: string | null; host?: string | null };

const API_HOSTS = ['itunes.apple.com', 'open.spotify.com', 'www.youtube.com'];
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  if (cache.size > 300) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export interface PodcastsDeps {
  fetchJson?: (url: string) => Promise<unknown>;
  fetchText?: (url: string) => Promise<{ url: string; status: number; contentType: string; text: string }>;
  now?: Date;
}

/** Per-request outbound budget, so one request cannot fan out into unlimited external calls. */
function budgeted<A extends unknown[], R>(fn: (...a: A) => Promise<R>, max: number) {
  let used = 0;
  return (...a: A) => {
    if (++used > max) return Promise.reject(new UnsafeUrlError('Outbound request budget reached', 'not_allowed'));
    return fn(...a);
  };
}

/** `qlooFor` is only passed by the private LIVE endpoint; the public one always uses MOCK. */
export async function handlePodcasts(req: PodcastsRequest, env: Env, deps: PodcastsDeps = {}, qlooFor: () => QlooAdapter = () => new MockQlooAdapter()): Promise<{ status: number; body: unknown }> {
  const fetchJson = budgeted((u: string) => cached(`j:${u}`, () => (deps.fetchJson ?? ((x: string) => safeJson(x, { allowHosts: API_HOSTS, timeoutMs: 6000 })))(u)), 3);
  const fetchText = budgeted((u: string) => cached(`t:${u}`, () => (deps.fetchText ?? ((x: string) => safeFetch(x, { maxBytes: 8_000_000, timeoutMs: 10_000, accept: 'application/rss+xml, application/xml, text/xml, */*' })))(u)), 1);
  const catalog: CatalogRef[] = CATALOG.shows.map((s) => ({ id: s.id, appleUrl: s.appleUrl, feedUrl: s.feedUrl, origin: s.origin }));
  const search = new OpenPodcastSearch({ fetchJson, fetchText, catalog });
  try {
    if (req.action === 'search') {
      if (typeof req.term !== 'string' || req.term.trim().length < 2) return { status: 400, body: { error: 'term must have at least 2 characters' } };
      const hits = await search.searchByName(req.term, req.store);
      return { status: 200, body: { hits, note: 'Store availability is not evidence of origin.', noteEs: 'La disponibilidad en una tienda no demuestra el origen.' } };
    }
    if (req.action === 'resolve') {
      if (typeof req.url !== 'string' || req.url.length > 500) return { status: 400, body: { error: 'url is required (max 500 characters)' } };
      return { status: 200, body: await search.resolveLink(req.url) };
    }
    if (req.action === 'analyze') {
      if (typeof req.feedUrl !== 'string' || req.feedUrl.length > 500) return { status: 400, body: { error: 'feedUrl is required' } };
      // Catalog shows keep their curated dataset and verified origin.
      const known = CATALOG.shows.find((s) => s.feedUrl === req.feedUrl);
      const knownDs = known && DATASETS.find((d) => d.id === known.id);
      let analysis;
      let target;
      if (knownDs) {
        target = knownDs;
        analysis = { level: known!.status === 'analyzable' ? 'complete' : known!.status === 'limited' ? 'limited' : 'insufficient', reasons: [], sources: [known!.feedUrl, known!.appleUrl], stats: null, catalogId: known!.id };
      } else {
        const r = await fetchText(req.feedUrl);
        if (r.status >= 400) return { status: 200, body: { analysis: { level: 'insufficient', reasons: [{ en: `The feed answered HTTP ${r.status}.`, es: `El feed respondió HTTP ${r.status}.` }], sources: [req.feedUrl], stats: null }, result: null } };
        const a = analyzeFeedXml(r.text, { feedUrl: r.url, appleUrl: req.appleUrl ?? null, host: req.host ?? null, now: deps.now });
        analysis = { level: a.level, reasons: a.reasons, sources: a.sources, stats: a.stats };
        target = a.dataset;
      }
      if (!target || analysis.level === 'insufficient') return { status: 200, body: { analysis, result: null } };
      const others = DATASETS.filter((d) => d.id !== target.id);
      const origin = known?.origin ?? { country: null, status: 'unverified', basis: null, evidence: [], note: 'Not in the curated catalog: origin not verified.' };
      const result = await recommendFor(target, others, qlooFor(), env, 5, origin);
      return { status: 200, body: { analysis, result, origin } };
    }
    return { status: 400, body: { error: 'Unknown action' } };
  } catch (err) {
    if (err instanceof UnsafeUrlError) return { status: 400, body: { error: err.message, code: err.code } };
    return { status: 502, body: { error: 'External source unavailable' } };
  }
}

export { ORIGIN_OF };
