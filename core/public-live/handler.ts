// PUBLIC Qloo LIVE endpoint (/api/discover): anyone can analyze a podcast with the real Qloo API,
// with no token, inside the limits enforced by PublicGuard.
//
// What it accepts (anything else is refused, so no private diagnostic action is reachable here):
//   status                       → whether public LIVE is on, its scope and today's remaining budget;
//   recommend { showId }         → a show from the curated catalog;
//   analyze   { appleId }        → a show found through the open search. The feed URL is NOT taken from
//                                  the client: it is looked up in Apple's directory, fetched through the
//                                  SSRF-safe client, parsed as RSS, and its title must match Apple's.
//   coverage                     → how much Qloo knew about each show analyzed live (counts only).
// Failures are reported as failures (never replaced by MOCK). The key stays in this process.

import { CATALOG, DATASETS, recommendFor, type Env } from '../api';
import { LiveQlooAdapter, type QlooLimits } from '../qloo/client';
import type { QlooAdapter } from '../qloo/types';
import { safeFetch, safeJson, UnsafeUrlError } from '../net/safe-fetch';
import { analyzeFeedXml, OpenPodcastSearch, type FetchJson, type FetchText } from '../podcasts/open-search';
import { compactKey } from '../qloo/signals';
import { randomBytes } from 'node:crypto';
import type { PodcastDataset } from '../types';
import { coverageOf, type CoverageRow } from '../coverage';
import { cacheKeyFor, casUpdate, PublicGuard, publicConfig, type CasStore, type PublicConfig, type PublicEnv, type Refusal } from './guard';

export interface PublicLiveEnv extends PublicEnv, Env {}

export type PublicLiveRequest = { action: 'status' } | { action: 'recommend'; showId: string } | { action: 'analyze'; appleId: number } | { action: 'job'; jobId: string } | { action: 'coverage' };

const COVERAGE_KEY = 'coverage/index';
const verifiedCountry = (showId: string) => {
  const o = CATALOG.shows.find((s) => s.id === showId)?.origin;
  return o?.status === 'verified' ? (o.country ?? null) : null;
};

/** Records one live run's coverage counts; a failure here never affects the analysis. */
async function recordCoverage(store: CasStore, key: string, row: CoverageRow | null) {
  if (!row) return;
  await casUpdate<Record<string, CoverageRow>>(store, COVERAGE_KEY, {}, (cur) => ({ ...cur, [key]: row })).catch(() => undefined);
}

/** Every live run recorded, plus catalog shows whose cached result predates the index. */
export async function readCoverage(store: CasStore, guard: PublicGuard): Promise<CoverageRow[]> {
  const index = ((await store.get(COVERAGE_KEY))?.data as Record<string, CoverageRow> | undefined) ?? {};
  const rows = { ...index };
  await Promise.all(
    DATASETS.filter((d) => !rows[`show:${d.id}`]).map(async (d) => {
      const hit = await guard.cached<Cached>(cacheKeyFor('show', d.id)).catch(() => null);
      const row = hit ? coverageOf(hit.body.result, { country: verifiedCountry(d.id), computedAt: hit.at }) : null;
      if (row) rows[`show:${d.id}`] = row;
    }),
  );
  return Object.values(rows).sort((a, b) => b.computedAt.localeCompare(a.computedAt));
}

export interface PublicLiveDeps {
  /** Shared CAS store (Netlify Blobs). null → the guard cannot work → no Qloo call (fail closed). */
  store: CasStore | null;
  ip: string | null;
  now?: () => number;
  /** Tests inject a scripted adapter; production builds the real one. */
  qlooFactory?: (limits: QlooLimits) => QlooAdapter & { metrics?: LiveQlooAdapter['metrics'] };
  fetchJson?: FetchJson;
  fetchText?: FetchText;
  /** Starts the background job (Netlify: POST to the background function). Absent → no LIVE run. */
  trigger?: (jobId: string) => Promise<boolean>;
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
  // Partial only when answers were really lost: a 429 that was retried and then answered is not a loss.
  const lostAnswers = m.lost ?? Object.keys(errors).length;
  return { state: lostAnswers ? ('partial' as const) : ('ok' as const), code: null, errors };
}

const FAILURE: Record<string, Bi> = {
  qloo_auth: msg('Qloo rejected the request (authorization). The result was not generated; nothing was substituted.', 'Qloo rechazó la solicitud (autorización). No se generó el resultado ni se reemplazó por otro.'),
  qloo_unavailable: msg('Qloo did not answer (timeout or service error). The result was not generated; nothing was substituted.', 'Qloo no respondió (tiempo agotado o error del servicio). No se generó el resultado ni se reemplazó por otro.'),
};

export async function handlePublicLive(req: unknown, env: PublicLiveEnv, deps: PublicLiveDeps): Promise<{ status: number; body: unknown }> {
  const r = req as Partial<{ action: string; showId: unknown; appleId: unknown; jobId: unknown }>;
  const action = r?.action;
  if (action !== 'status' && action !== 'recommend' && action !== 'analyze' && action !== 'job' && action !== 'coverage') return { status: 400, body: { error: 'Unknown action' } };
  const now = deps.now ?? Date.now;
  const cfg = publicConfig(env);
  if (action === 'job') {
    if (typeof r.jobId !== 'string' || !/^[0-9a-f]{32}$/.test(r.jobId)) return { status: 400, body: { error: 'jobId is required' } };
    if (!deps.store) return refuseBare('guard_unavailable');
    return pollJob(deps.store, r.jobId, cfg, now()).catch(() => refuseBare('guard_unavailable'));
  }
  const enabled = publicSwitch(env);
  const guard = deps.store ? new PublicGuard(deps.store, cfg, now, env.PUBLIC_IP_SALT ?? '') : null;
  if (action === 'coverage') {
    if (!deps.store || !guard) return { status: 200, body: { rows: [] } };
    return { status: 200, body: { rows: await readCoverage(deps.store, guard).catch(() => []) } };
  }

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
      // Already in the catalog: its curated dataset and verified origin, and the same cache entry.
      const c = CATALOG.shows.find((s) => s.id === known.id)!;
      target = known;
      origin = c.origin;
      kind = 'catalog';
      cacheKey = cacheKeyFor('show', known.id);
      analysis = { level: 'complete', reasons: [], sources: [c.feedUrl, c.appleUrl], stats: null, catalogId: known.id };
    } else {
      cacheKey = cacheKeyFor('feed', hit.feedUrl);
      const cachedOpen = await guard.cached<Cached>(cacheKey).catch(() => null);
      if (current(cachedOpen)) return { status: 200, body: { analysis: cachedOpen.body.analysis, result: withLive(cachedOpen.body.result, { cached: true, computedAt: cachedOpen.at }) } };
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
  }

  // ---------------------------------------------------------------- cache, then a queued LIVE job
  const respond = (result: unknown, an: unknown) => (action === 'analyze' ? { analysis: an, result } : result);
  const prior = await guard.cached<Cached>(cacheKey).catch(() => null);
  if (current(prior)) return { status: 200, body: respond(withLive(prior.body.result, { cached: true, computedAt: prior.at, partial: prior.body.partial ?? false }), prior.body.analysis ?? analysis) };
  if (!deps.trigger) return refuse('guard_unavailable', prior); // no way to run the job → no reservation
  // The same show is already being analyzed: join that job instead of paying for a second run.
  const running = await joinable(deps.store!, cacheKey, cfg, now()).catch(() => null);
  if (running) return { status: 202, body: { jobId: running, status: 'running', shared: true } };
  let lease;
  try {
    lease = await guard.reserve(kind, deps.ip);
  } catch {
    return refuse('guard_unavailable', prior); // fail closed: no Qloo call without a working guard
  }
  if (!lease.ok) return refuse(lease.reason, prior);
  const job: Job = {
    id: randomBytes(16).toString('hex'),
    status: 'queued',
    createdAt: new Date(now()).toISOString(),
    leaseId: lease.leaseId,
    cacheKey,
    respondAs: action,
    target: kind === 'catalog' ? { kind, showId: target.id, origin, analysis } : { kind, dataset: target, origin, analysis },
  };
  const notStarted = { status: 502, body: { code: 'start_failed', message: msg('The analysis could not be started. No Qloo query was made.', 'No se pudo iniciar el análisis. No se hizo ninguna consulta a Qloo.'), retry: true } };
  try {
    await deps.store!.put(`job/${job.id}`, job);
    await deps.store!.put(`inflight/${cacheKey}`, { jobId: job.id, at: job.createdAt });
  } catch {
    await guard.settle(lease.leaseId, 0).catch(() => undefined);
    return refuse('guard_unavailable', prior);
  }
  if (!(await deps.trigger(job.id).catch(() => false))) {
    await finish(deps.store!, job, notStarted).catch(() => undefined);
    await guard.settle(lease.leaseId, 0).catch(() => undefined);
    return notStarted;
  }
  return { status: 202, body: { jobId: job.id, status: 'queued' } };

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
  partial?: boolean;
  /** RULES_VERSION the result was computed with; absent on results from before it existed (version 1). */
  rules?: number;
}

/**
 * Bumped when a change to the agent's rules would change who is recommended. A cached result from older
 * rules is recomputed on the next visit (and still shown, dated, if the visit cannot start a new run).
 * Version 2: unrecorded citizenship or language no longer excludes Qloo's proposals; photos for them.
 * Version 3: past guests are checked against the whole feed and the public record, not only the
 * analyzed episodes.
 * Version 4: the name-in-a-title check covers every candidate and the official YouTube titles.
 */
export const RULES_VERSION = 4;
const current = <T extends { fresh: boolean; body: Cached }>(c: T | null): c is T => Boolean(c?.fresh && (c.body.rules ?? 1) >= RULES_VERSION);

function refuseBare(code: 'guard_unavailable') {
  return { status: STATUS_OF[code], body: { code, message: REFUSAL[code], retry: true } };
}

// ================================================================== background jobs
// A public LIVE analysis runs in a Netlify Background Function (up to 15 min), not inside the HTTP
// request: the synchronous path was observed failing at 30 s. The job lives in the same Blobs store
// as the limits; the browser polls { action: 'job', jobId } until the outcome is written.

export interface Job {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  leaseId: string;
  cacheKey: string;
  respondAs: 'recommend' | 'analyze';
  target: { kind: 'catalog'; showId: string; origin: unknown; analysis: unknown } | { kind: 'open'; dataset: PodcastDataset; origin: unknown; analysis: unknown };
  /** The HTTP answer the poller gets once the job is over (LIVE result or an honest failure). */
  outcome?: { status: number; body: unknown };
  qlooCalls?: number;
}

/** A job may only sit in the queue this long before the poller reports it as not started. */
const QUEUE_MAX_MS = 90_000;

async function finish(store: CasStore, job: Job, outcome: { status: number; body: unknown }, extra: Partial<Job> = {}) {
  await store.put(`job/${job.id}`, { ...job, ...extra, status: outcome.status === 200 ? 'done' : 'failed', finishedAt: new Date().toISOString(), outcome } satisfies Job);
}

const stalled = (job: Job, cfg: PublicConfig, now: number) =>
  (job.status === 'queued' && now - Date.parse(job.createdAt) > QUEUE_MAX_MS) || (job.status === 'running' && now - Date.parse(job.startedAt ?? job.createdAt) > cfg.leaseMs);

/** An unfinished, healthy job already analyzing this show, if any. */
async function joinable(store: CasStore, cacheKey: string, cfg: PublicConfig, now: number): Promise<string | null> {
  const ref = (await store.get(`inflight/${cacheKey}`))?.data as { jobId: string } | undefined;
  if (!ref) return null;
  const job = (await store.get(`job/${ref.jobId}`))?.data as Job | undefined;
  return job && (job.status === 'queued' || job.status === 'running') && !stalled(job, cfg, now) ? job.id : null;
}

export async function pollJob(store: CasStore, jobId: string, cfg: PublicConfig, now: number): Promise<{ status: number; body: unknown }> {
  const job = (await store.get(`job/${jobId}`))?.data as Job | undefined;
  if (!job) return { status: 404, body: { code: 'unknown_job', message: msg('This analysis does not exist or has expired.', 'Este análisis no existe o ya expiró.'), retry: false } };
  if (job.outcome) return job.outcome;
  if (stalled(job, cfg, now)) {
    // The function never started or died: report it; the unsettled lease expires and counts in full.
    const outcome = { status: 502, body: { code: 'stalled', message: msg('The analysis stopped before finishing. Nothing was substituted.', 'El análisis se detuvo antes de terminar. No se reemplazó por otro resultado.'), retry: true } };
    await finish(store, job, outcome).catch(() => undefined);
    return outcome;
  }
  return { status: 202, body: { jobId, status: job.status, elapsedMs: now - Date.parse(job.createdAt) } };
}

/** Qloo limits for a background analysis: paced to stay under Qloo's rate limit, with time to back off. */
export function backgroundLimits(cfg: PublicConfig): QlooLimits {
  return {
    maxCalls: cfg.callsPerAnalysis,
    concurrency: 3,
    minIntervalMs: 250,
    // Measured LIVE (2026-10-23, CREATIVO): /v2/insights with 12 tag ids took over 10 s. The background
    // job has minutes, so a slow answer is waited for instead of being lost.
    timeoutMs: 25_000,
    deadlineMs: Math.max(30_000, cfg.jobMaxMs - 60_000),
    retries: 1,
    retries429: 3,
    maxRetryWaitMs: 15_000,
  };
}

/**
 * Runs one queued job. Idempotent: Netlify retries a failed background invocation, and anyone may
 * POST a job id; only a job still `queued` is claimed (compare-and-swap), and it never throws.
 */
export async function runPublicJob(jobId: string, env: PublicLiveEnv, deps: Pick<PublicLiveDeps, 'store' | 'qlooFactory' | 'now'>): Promise<void> {
  const store = deps.store;
  if (!store || !/^[0-9a-f]{32}$/.test(jobId)) return;
  const cfg = publicConfig(env);
  const guard = new PublicGuard(store, cfg, deps.now ?? Date.now, env.PUBLIC_IP_SALT ?? '');
  let job: Job;
  try {
    const cur = await store.get(`job/${jobId}`);
    if (!cur || (cur.data as Job).status !== 'queued') return;
    job = { ...(cur.data as Job), status: 'running', startedAt: new Date().toISOString() };
    if (!(await store.set(`job/${jobId}`, job, { onlyIfMatch: cur.etag }))) return; // someone else claimed it
  } catch {
    return;
  }
  const limits = backgroundLimits(cfg);
  let adapter: (QlooAdapter & { metrics?: LiveQlooAdapter['metrics'] }) | null = null;
  const respond = (result: unknown) => (job.respondAs === 'analyze' ? { analysis: job.target.analysis, result } : result);
  try {
    if (!publicSwitch(env)) throw new Error('disabled while queued');
    if ((await guard.control()).paused) {
      await guard.settle(job.leaseId, 0).catch(() => undefined);
      return await finish(store, job, { status: 503, body: { code: 'paused', message: REFUSAL.paused, retry: false } }, { qlooCalls: 0 });
    }
    const t = job.target;
    const target = t.kind === 'catalog' ? DATASETS.find((d) => d.id === t.showId) : t.dataset;
    if (!target) throw new Error('target missing');
    adapter = deps.qlooFactory ? deps.qlooFactory(limits) : new LiveQlooAdapter({ apiKey: env.QLOO_API_KEY!, baseUrl: env.QLOO_BASE_URL, limits });
    const runEnv = { ...env, EXTERNAL_VERIFY_MAX: String(cfg.externalVerifyMax) };
    const result = await recommendFor(target, DATASETS.filter((d) => d.id !== target.id), adapter, runEnv, 5, t.origin, { deadlineMs: limits.deadlineMs + 20_000 });
    const calls = adapter.metrics?.networkCalls ?? cfg.callsPerAnalysis;
    await guard.settle(job.leaseId, calls).catch(() => undefined); // if this fails, the lease expires and counts in full
    const health = liveHealth(adapter.metrics);
    if (health.state === 'failed')
      return await finish(store, job, { status: 502, body: { code: health.code, message: FAILURE[health.code!], errors: health.errors, qlooCalls: calls, retry: true } }, { qlooCalls: calls });
    const partial = health.state === 'partial';
    // Complete results are cached for PUBLIC_CACHE_HOURS; results that lost some Qloo answers for
    // PUBLIC_PARTIAL_CACHE_HOURS (labeled partial), so one bad minute at Qloo is not re-paid by every visitor.
    const ttl = partial ? cfg.partialCacheHours : cfg.cacheHours;
    if (ttl > 0) await guard.saveResult(job.cacheKey, { result, analysis: t.analysis, partial, rules: RULES_VERSION } satisfies Cached, ttl).catch(() => undefined);
    const computedAt = new Date().toISOString();
    await recordCoverage(store, t.kind === 'catalog' ? `show:${t.showId}` : `feed:${target.name}`, coverageOf(result, { country: t.kind === 'catalog' ? verifiedCountry(t.showId) : null, computedAt }));
    await finish(store, job, { status: 200, body: respond(withLive(result, { cached: false, computedAt: new Date().toISOString(), qlooCalls: calls, partial, errors: health.errors, ...(adapter.metrics?.rateLimit ? { qlooRateLimit: adapter.metrics.rateLimit } : {}) })) }, { qlooCalls: calls });
  } catch {
    const calls = adapter?.metrics?.networkCalls ?? 0;
    await guard.settle(job.leaseId, calls).catch(() => undefined);
    await finish(store, job, { status: 502, body: { code: 'analysis_failed', message: msg('The analysis failed before finishing. Nothing was substituted.', 'El análisis falló antes de terminar. No se reemplazó por otro resultado.'), retry: true } }, { qlooCalls: calls }).catch(() => undefined);
  }
}
