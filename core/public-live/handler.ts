// PUBLIC Qloo LIVE endpoint (/api/discover): anyone can analyze a podcast with the real Qloo API,
// with no token, inside the limits enforced by PublicGuard.
//
// What it accepts (anything else is refused, so no private diagnostic action is reachable here):
//   status                       → whether public LIVE is on, its scope and today's remaining budget;
//   recommend { showId }         → a show from the curated catalog;
//   analyze   { appleId }        → a show found through the open search. The feed URL is NOT taken from
//                                  the client: it is looked up in Apple's directory, fetched through the
//                                  SSRF-safe client, parsed as RSS, and its title must match Apple's.
// Failures are reported as failures (never replaced by MOCK). The key stays in this process.

import { CATALOG, DATASETS, recommendFor, type Env } from '../api';
import { LiveQlooAdapter, type QlooLimits } from '../qloo/client';
import type { QlooAdapter } from '../qloo/types';
import { safeFetch, safeJson, UnsafeUrlError } from '../net/safe-fetch';
import { analyzeFeedXml, OpenPodcastSearch, type FetchJson, type FetchText } from '../podcasts/open-search';
import { compactKey } from '../qloo/signals';
import { cacheKeyFor, PublicGuard, publicConfig, type CasStore, type PublicEnv, type Refusal } from './guard';

export interface PublicLiveEnv extends PublicEnv, Env {}

export type PublicLiveRequest = { action: 'status' } | { action: 'recommend'; showId: string } | { action: 'analyze'; appleId: number };

export interface PublicLiveDeps {
  /** Shared CAS store (Netlify Blobs). null → the guard cannot work → no Qloo call (fail closed). */
  store: CasStore | null;
  ip: string | null;
  now?: () => number;
  /** Tests inject a scripted adapter; production builds the real one. */
  qlooFactory?: (limits: QlooLimits) => QlooAdapter & { metrics?: LiveQlooAdapter['metrics'] };
  fetchJson?: FetchJson;
  fetchText?: FetchText;
}

type Bi = { en: string; es: string };
const msg = (en: string, es: string): Bi => ({ en, es });

const REFUSAL: Record<Refusal | 'disabled' | 'guard_unavailable', Bi> = {
  disabled: msg('Public Qloo LIVE is switched off.', 'El acceso público a Qloo LIVE está apagado.'),
  paused: msg('Public Qloo LIVE is paused by the operators. No new Qloo queries are being made.', 'El acceso público a Qloo LIVE está en pausa por los operadores. No se hacen nuevas consultas a Qloo.'),
  budget: msg('Today’s Qloo query budget for the public demo is used up. It resets at 00:00 UTC.', 'Se agotó el presupuesto diario de consultas a Qloo de la demo pública. Se renueva a las 00:00 UTC.'),
  busy: msg('Other analyses are running with Qloo right now. Try again in a minute.', 'Hay otros análisis usando Qloo en este momento. Probá de nuevo en un minuto.'),
  visitor_limit: msg('You reached today’s limit of new Qloo analyses. Shows already analyzed today are still available.', 'Alcanzaste el límite diario de análisis nuevos con Qloo. Los programas ya analizados hoy siguen disponibles.'),
  open_limit: msg('Today’s limit of new podcasts from the open search is used up. Catalog podcasts are still available.', 'Se agotó el cupo diario de podcasts nuevos de la búsqueda abierta. Los del catálogo siguen disponibles.'),
  guard_unavailable: msg('The usage limits cannot be checked right now, so no Qloo query is made. Try again later.', 'No se pueden verificar los límites de uso en este momento, así que no se consulta a Qloo. Probá más tarde.'),
};

const STATUS_OF: Record<string, number> = { disabled: 503, paused: 503, guard_unavailable: 503, budget: 429, busy: 429, visitor_limit: 429, open_limit: 429 };

export function publicSwitch(env: PublicLiveEnv): boolean {
  return env.QLOO_PUBLIC_ENABLED === 'true' && Boolean(env.QLOO_API_KEY);
}

/** Classifies a finished LIVE run from the adapter's own counters. */
export function liveHealth(m: LiveQlooAdapter['metrics'] | undefined) {
  if (!m) return { state: 'failed' as const, code: 'qloo_unavailable', errors: {} as Record<string, number> };
  const ok = Object.entries(m.statuses).filter(([s]) => +s >= 200 && +s < 300).reduce((a, [, n]) => a + n, 0);
  const auth = (m.statuses[401] ?? 0) + (m.statuses[403] ?? 0);
  const errors: Record<string, number> = { ...m.errors };
  for (const [s, n] of Object.entries(m.statuses)) if (+s >= 400) errors[`http_${s}`] = n;
  if (auth) return { state: 'failed' as const, code: 'qloo_auth', errors };
  if (!ok && !m.cacheHits) return { state: 'failed' as const, code: 'qloo_unavailable', errors };
  return { state: Object.keys(errors).length ? ('partial' as const) : ('ok' as const), code: null, errors };
}

const FAILURE: Record<string, Bi> = {
  qloo_auth: msg('Qloo rejected the request (authorization). The result was not generated; nothing was substituted.', 'Qloo rechazó la solicitud (autorización). No se generó el resultado ni se reemplazó por otro.'),
  qloo_unavailable: msg('Qloo did not answer (timeout or service error). The result was not generated; nothing was substituted.', 'Qloo no respondió (tiempo agotado o error del servicio). No se generó el resultado ni se reemplazó por otro.'),
};

export async function handlePublicLive(req: unknown, env: PublicLiveEnv, deps: PublicLiveDeps): Promise<{ status: number; body: unknown }> {
  const r = req as Partial<{ action: string; showId: unknown; appleId: unknown }>;
  const action = r?.action;
  if (action !== 'status' && action !== 'recommend' && action !== 'analyze') return { status: 400, body: { error: 'Unknown action' } };
  const now = deps.now ?? Date.now;
  const cfg = publicConfig(env);
  const enabled = publicSwitch(env);
  const guard = deps.store ? new PublicGuard(deps.store, cfg, now, env.PUBLIC_IP_SALT ?? '') : null;

  if (action === 'status') {
    let paused = false;
    let remaining: number | null = null;
    if (enabled && guard)
      try {
        paused = (await guard.control()).paused;
        remaining = (await guard.usage()).remaining;
      } catch {
        return { status: 200, body: { live: false, code: 'guard_unavailable', message: REFUSAL.guard_unavailable } };
      }
    const live = enabled && Boolean(guard) && !paused;
    return {
      status: 200,
      body: {
        live,
        code: !enabled ? 'disabled' : !guard ? 'guard_unavailable' : paused ? 'paused' : null,
        message: !enabled ? REFUSAL.disabled : !guard ? REFUSAL.guard_unavailable : paused ? REFUSAL.paused : null,
        scope: { catalog: DATASETS.map((d) => d.id), openSearch: 'apple-directory' },
        limits: { callsPerAnalysis: cfg.callsPerAnalysis, freshPerVisitorPerDay: cfg.freshPerIpPerDay, openFeedsPerDay: cfg.openFeedsPerDay, cacheHours: cfg.cacheHours },
        remainingCallsToday: remaining,
      },
    };
  }

  if (!enabled) return refuse('disabled');
  if (!guard) return refuse('guard_unavailable');

  // ---------------------------------------------------------------- what to analyze
  let target;
  let origin: unknown;
  let kind: 'catalog' | 'open';
  let cacheKey: string;
  let analysis: unknown = null;
  if (action === 'recommend') {
    target = typeof r.showId === 'string' ? DATASETS.find((d) => d.id === r.showId) : undefined;
    if (!target) return { status: 404, body: { error: 'Unknown show (public LIVE covers the catalog shows and Apple-directory shows).' } };
    origin = CATALOG.shows.find((s) => s.id === target!.id)?.origin ?? null;
    kind = 'catalog';
    cacheKey = cacheKeyFor('show', target.id);
  } else {
    const appleId = Number(r.appleId);
    if (!Number.isSafeInteger(appleId) || appleId <= 0) return { status: 400, body: { error: 'appleId must be a positive integer' } };
    const fetchJson = deps.fetchJson ?? ((u: string) => safeJson(u, { allowHosts: ['itunes.apple.com'], timeoutMs: 6000 }));
    const fetchText = deps.fetchText ?? ((u: string) => safeFetch(u, { maxBytes: 8_000_000, timeoutMs: 10_000, accept: 'application/rss+xml, application/xml, text/xml, */*' }));
    const search = new OpenPodcastSearch({ fetchJson, fetchText, catalog: CATALOG.shows.map((s) => ({ id: s.id, appleUrl: s.appleUrl, feedUrl: s.feedUrl, origin: s.origin })) });
    let hit;
    try {
      hit = await search.lookupApple(appleId);
    } catch {
      return { status: 502, body: { code: 'source_unavailable', message: msg('Apple’s podcast directory did not answer. Try again.', 'El directorio de podcasts de Apple no respondió. Probá de nuevo.'), retry: true } };
    }
    if (!hit?.feedUrl) return { status: 404, body: { code: 'not_in_directory', message: msg('This podcast has no public feed in Apple’s directory, so it cannot be analyzed with Qloo here.', 'Este podcast no tiene un feed público en el directorio de Apple, así que no se puede analizar con Qloo aquí.') } };
    const known = hit.catalogId ? DATASETS.find((d) => d.id === hit!.catalogId) : undefined;
    if (known) {
      const c = CATALOG.shows.find((s) => s.id === known.id)!;
      const out = await handlePublicLive({ action: 'recommend', showId: known.id }, env, deps);
      if (out.status !== 200) return out;
      return { status: 200, body: { analysis: { level: 'complete', reasons: [], sources: [c.feedUrl, c.appleUrl], stats: null, catalogId: known.id }, result: out.body } };
    }
    cacheKey = cacheKeyFor('feed', hit.feedUrl);
    const cachedOpen = await guard.cached<Cached>(cacheKey).catch(() => null);
    if (cachedOpen?.fresh) return { status: 200, body: { analysis: cachedOpen.body.analysis, result: withLive(cachedOpen.body.result, { cached: true, computedAt: cachedOpen.at }) } };
    let feed;
    try {
      feed = await fetchText(hit.feedUrl);
    } catch (err) {
      if (err instanceof UnsafeUrlError) return { status: 400, body: { code: 'unsafe_feed', message: msg(`The feed address was refused by the safety checks (${err.code}).`, `La dirección del feed fue rechazada por los controles de seguridad (${err.code}).`) } };
      return { status: 502, body: { code: 'source_unavailable', message: msg('The podcast’s feed did not answer. Try again.', 'El feed del podcast no respondió. Probá de nuevo.'), retry: true } };
    }
    if (feed.status >= 400) return { status: 502, body: { code: 'source_unavailable', message: msg(`The feed answered HTTP ${feed.status}.`, `El feed respondió HTTP ${feed.status}.`), retry: true } };
    const a = analyzeFeedXml(feed.text, { feedUrl: feed.url, appleUrl: hit.appleUrl, host: hit.publisher });
    analysis = { level: a.level, reasons: a.reasons, sources: a.sources, stats: a.stats };
    // Legitimacy: the feed Apple lists must describe the same show Apple lists.
    const same = a.dataset && (compactKey(a.dataset.name).includes(compactKey(hit.name)) || compactKey(hit.name).includes(compactKey(a.dataset.name)));
    if (a.dataset && !same) return { status: 422, body: { code: 'feed_mismatch', analysis, message: msg('The feed’s title does not match the show in Apple’s directory, so it was not analyzed.', 'El título del feed no coincide con el programa del directorio de Apple, así que no se analizó.') } };
    if (!a.dataset || a.level === 'insufficient') return { status: 200, body: { analysis, result: null } };
    target = a.dataset;
    origin = { country: null, status: 'unverified', basis: null, evidence: [], note: 'Not in the curated catalog: origin not verified.' };
    kind = 'open';
  }

  // ---------------------------------------------------------------- cache, then a guarded LIVE run
  const respond = (result: unknown, an: unknown) => (action === 'analyze' ? { analysis: an, result } : result);
  const prior = await guard.cached<Cached>(cacheKey).catch(() => null);
  if (prior?.fresh) return { status: 200, body: respond(withLive(prior.body.result, { cached: true, computedAt: prior.at }), prior.body.analysis ?? analysis) };
  let lease;
  try {
    lease = await guard.reserve(kind, deps.ip);
  } catch {
    return refuse('guard_unavailable', prior); // fail closed: no Qloo call without a working guard
  }
  if (!lease.ok) return refuse(lease.reason, prior);

  // The public synchronous function was observed timing out at 30 s. Reserve time for
  // external verification, baseline comparison, settlement and the HTTP response.
  // Prioritize discovering people over optional cultural/affinity enrichment.
  const limits: QlooLimits = { maxCalls: Math.min(cfg.callsPerAnalysis, 24), concurrency: 2, timeoutMs: 2500, deadlineMs: 15_000, retries: 0 };
  const adapter = deps.qlooFactory ? deps.qlooFactory(limits) : new LiveQlooAdapter({ apiKey: env.QLOO_API_KEY!, baseUrl: env.QLOO_BASE_URL, limits });
  let result;
  try {
    result = await recommendFor(target, DATASETS.filter((d) => d.id !== target!.id), adapter,
      { ...env, EXTERNAL_VERIFY_MAX: String(Math.min(4, Math.max(1, Number(env.EXTERNAL_VERIFY_MAX) || 4))), PROFILE_LOOKUP: '0' },
      5, origin, { publicFast: true, deadlineMs: 20_000 });
  } catch {
    await guard.settle(lease.leaseId, adapter.metrics?.networkCalls ?? cfg.callsPerAnalysis).catch(() => undefined);
    return { status: 502, body: { code: 'analysis_failed', message: msg('The analysis failed before finishing. Nothing was substituted.', 'El análisis falló antes de terminar. No se reemplazó por otro resultado.'), retry: true } };
  }
  const calls = adapter.metrics?.networkCalls ?? cfg.callsPerAnalysis;
  await guard.settle(lease.leaseId, calls).catch(() => undefined); // if this fails, the lease expires and counts in full
  const health = liveHealth(adapter.metrics);
  if (health.state === 'failed') return { status: 502, body: { code: health.code, message: FAILURE[health.code!], errors: health.errors, qlooCalls: calls, retry: true } };
  const meta = { cached: false, computedAt: new Date(now()).toISOString(), qlooCalls: calls, partial: health.state === 'partial', errors: health.errors };
  // Only complete runs are cached; a partial one is shown once, labeled as partial.
  if (health.state === 'ok') await guard.saveResult(cacheKey, { result, analysis } satisfies Cached).catch(() => undefined);
  return { status: 200, body: respond(withLive(result, meta), analysis) };

  function refuse(code: Refusal | 'disabled' | 'guard_unavailable', stale?: { at: string; body: Cached } | null) {
    return {
      status: STATUS_OF[code],
      body: {
        code,
        message: REFUSAL[code],
        retry: code === 'busy' || code === 'guard_unavailable',
        // An earlier LIVE result for the same show, clearly dated, when one exists. Never MOCK.
        staleLive: stale ? respond(withLive(stale.body.result, { cached: true, computedAt: stale.at, stale: true }), stale.body.analysis) : null,
      },
    };
  }
}

function withLive(result: unknown, live: Record<string, unknown>) {
  return { ...(result as object), live: { mode: 'LIVE', ...live } };
}
interface Cached {
  result: unknown;
  analysis: unknown;
}
