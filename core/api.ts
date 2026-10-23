// Request handler shared by the Netlify Function and the Vite dev server.
// Runs server-side, so QLOO_API_KEY never reaches the browser.

import catalogJson from '../data/catalog.json';
import { ALL_DATASETS, CORE_IDS } from './datasets';
import profilesJson from '../data/profiles.json';
import type { PodcastDataset } from './types';
import { runAgent } from './agent/agent';
import { runBacktest } from './backtest';
import { LiveQlooAdapter, summarizeMetrics, type QlooLimits } from './qloo/client';
import { MockQlooAdapter, NoQlooAdapter } from './qloo/mock';
import { compareArms, compareWithBaseline } from './discovery';
import { BLIND_RUBRIC, blindNames, blindSheetCsv, buildBlindSet, sha256 } from './editorial';
import { WikidataVerifier } from './verify/external';
import { safeJson } from './net/safe-fetch';
import { QlooError, type QlooAdapter } from './qloo/types';
import { HourlyQuota, limitsFromEnv, liveSwitch, verifyBearer, type LiveEnv } from './access';
import { runComparison, runCoverage, runOriginality, summarizeComparison, summarizeCoverage } from './experiment';
import { redact } from './qloo/credentials';
import { resolveProfiles, type GuestProfile } from './profiles';
import { nameKey } from './names';
import { PublicGuard, publicConfig, type CasStore, type PublicEnv } from './public-live/guard';

/** Every analyzable catalog show; each one is a comparison show for the others. */
export const DATASETS: PodcastDataset[] = ALL_DATASETS;
/** The original three shows: a fixed corpus for regression tests and the historical backtest. */
export const CORE_DATASETS: PodcastDataset[] = ALL_DATASETS.filter((d) => CORE_IDS.includes(d.id));

export type CatalogShow = (typeof catalogJson)['shows'][number];
export const CATALOG = catalogJson;
/** Verified origin country per show (shows without a verified origin are absent). */
export const ORIGIN_OF = new Map(CATALOG.shows.filter((s) => s.origin.status === 'verified' && s.origin.country).map((s) => [s.id, s.origin.country as string]));

export interface Env extends LiveEnv {
  /** Set to "0" to skip live Wikipedia lookups (tests, offline environments). */
  PROFILE_LOOKUP?: string;
  /** Set to "0" to skip the Wikidata/Wikipedia verification of Qloo proposals (LIVE only). */
  EXTERNAL_VERIFY?: string;
  /** Maximum Qloo proposals verified in Wikidata/Wikipedia per analysis (default 12, max 30). */
  EXTERNAL_VERIFY_MAX?: string;
}

/** Private, server-side Qloo response cache shared by requests on a warm instance (allowed by the developer guide). */
const QLOO_CACHE: NonNullable<ConstructorParameters<typeof LiveQlooAdapter>[0]['cache']> = new Map();

/** LIVE only when explicitly switched on (QLOO_LIVE_ENABLED=true) and a key is present; MOCK otherwise. */
export function makeQloo(env: Env, limits?: Partial<QlooLimits>, sharedBudget?: { networkCalls: number; startedAt: number }): QlooAdapter {
  if (env.QLOO_LIVE_ENABLED !== 'true' || !env.QLOO_API_KEY) return new MockQlooAdapter();
  if (QLOO_CACHE.size > 5000) QLOO_CACHE.clear();
  return new LiveQlooAdapter({ apiKey: env.QLOO_API_KEY, baseUrl: env.QLOO_BASE_URL, limits: limits ?? limitsFromEnv(env), cache: QLOO_CACHE, sharedBudget });
}

export type ApiRequest =
  | { action: 'shows' }
  | { action: 'catalog' }
  | { action: 'recommend'; showId: string; k?: number }
  | { action: 'backtest'; showId: string; cutoff: string; horizonMonths?: number };

const STATIC_PROFILES = profilesJson as unknown as Record<string, GuestProfile>;
const runtimeProfiles = new Map<string, GuestProfile | null>();

/** Wikipedia/Wikidata lookup for people not in data/profiles.json. Best effort: any failure → null (initials avatar). */
async function liveProfiles(people: Array<{ name: string; appearanceTitles: string[] }>): Promise<void> {
  const todo = people.filter((p) => !runtimeProfiles.has(nameKey(p.name)));
  if (!todo.length) return;
  const fetchJson = async (url: string) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'GreenRoom/0.1 (Qloo hackathon demo)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const found = await resolveProfiles(todo, fetchJson, new Date().toISOString().slice(0, 10));
    for (const [name, prof] of found) runtimeProfiles.set(nameKey(name), prof);
  } catch {
    for (const p of todo) runtimeProfiles.set(nameKey(p.name), null);
  }
}

export async function profilesFor(recs: Array<{ key: string; name: string; appearances: Array<{ title: string }> }>, live: boolean): Promise<Record<string, GuestProfile | null>> {
  const missing = recs.filter((r) => !STATIC_PROFILES[r.key]);
  if (live && missing.length) await liveProfiles(missing.map((r) => ({ name: r.name, appearanceTitles: r.appearances.map((a) => a.title) })));
  return Object.fromEntries(recs.map((r) => [r.key, STATIC_PROFILES[r.key] ?? runtimeProfiles.get(r.key) ?? null]));
}

export function showSummaries() {
  return DATASETS.map((d) => {
    const eps = d.episodes.filter((e) => !e.excluded);
    const dates = eps.map((e) => e.published).filter(Boolean).sort();
    return {
      id: d.id,
      name: d.name,
      host: d.host,
      language: d.language,
      description: d.description,
      source: d.source,
      episodeCount: eps.length,
      withGuests: eps.filter((e) => e.guests.length > 0).length,
      firstEpisode: dates[0] ?? null,
      lastEpisode: dates[dates.length - 1] ?? null,
      recent: eps.slice(0, 6).map((e) => ({ title: e.title, published: e.published, url: e.url, guests: e.guests.map((g) => g.name) })),
    };
  });
}

/**
 * Public endpoint (/api/agent). Always MOCK, whatever the environment holds: the Qloo key is only
 * reachable through handleLive, behind the access token.
 */
export async function handleApi(req: ApiRequest, env: Env): Promise<{ status: number; body: unknown }> {
  return runAction(req, env, () => new MockQlooAdapter());
}

const WIKI_HOSTS = ['www.wikidata.org', 'en.wikipedia.org', 'es.wikipedia.org'];

/** Wikidata/Wikipedia verifier, used only with LIVE Qloo (it verifies Qloo's proposals). */
export function makeVerifier(env: Env) {
  if (env.EXTERNAL_VERIFY === '0') return undefined;
  // Default 12 per analysis; adjustable (1–30) only after measuring how many useful candidates the cap leaves out.
  const max = Math.min(30, Math.max(1, Number(env.EXTERNAL_VERIFY_MAX) || 12));
  return new WikidataVerifier({ fetchJson: (u) => safeJson(u, { allowHosts: WIKI_HOSTS, timeoutMs: 5000 }), maxCandidates: max });
}

/** One analysis: agent run, Wikipedia photos/profiles, and (LIVE) the baseline comparison. */
export async function recommendFor(target: PodcastDataset, others: PodcastDataset[], qloo: QlooAdapter, env: Env, k: number, origin: unknown) {
  const live = qloo.mode === 'LIVE';
  const verifier = live ? makeVerifier(env) : undefined;
  const result = await runAgent({ target, others, qloo, k, originOf: ORIGIN_OF, verifier });
  // LIVE: also run the baseline (no Qloo, no API calls) on the same data and rules, to show what Qloo added.
  const comparison = live ? compareWithBaseline(await runAgent({ target, others, qloo: new NoQlooAdapter(), k, originOf: ORIGIN_OF }), result) : null;
  const profiles = await profilesFor(result.recommendations, env.PROFILE_LOOKUP !== '0');
  // "Probable" language: an identity-checked Wikipedia article exists in the show's language.
  // Indirect evidence only; it never becomes "confirmed".
  for (const rec of result.recommendations) {
    const p = profiles[rec.key];
    const lang = target.language as 'en' | 'es';
    if (rec.language.status === 'unknown' && p && p.extract?.[lang]) {
      rec.language = {
        ...rec.language,
        status: 'probable',
        basis: 'wikipedia',
        evidenceEn: `${rec.language.evidenceEn}; Wikipedia article in “${lang}” (identity-checked)`,
        evidenceEs: `${rec.language.evidenceEs}; artículo de Wikipedia en “${lang}” (identidad verificada)`,
      };
    }
  }
  // Cost of the external verification (Wikidata/Wikipedia calls), to size the per-run cap with data.
  return { ...result, ranked: undefined, profiles, comparison, origin, externalVerification: verifier ? { calls: verifier.calls.length, cap: verifier.maxCandidates } : null };
}

async function runAction(req: ApiRequest, env: Env, qlooFor: () => QlooAdapter): Promise<{ status: number; body: unknown }> {
  if (req.action === 'catalog') return { status: 200, body: CATALOG };
  if (req.action === 'shows') return { status: 200, body: { qlooMode: qlooFor().mode === 'LIVE' ? 'LIVE' : 'MOCK', shows: showSummaries() } };
  const target = DATASETS.find((d) => d.id === req.showId);
  if (!target) return { status: 404, body: { error: `Unknown show ${req.showId}` } };
  const others = DATASETS.filter((d) => d.id !== target.id);
  if (req.action === 'recommend') {
    const k = Math.min(Math.max(req.k ?? 5, 1), 10);
    const body = await recommendFor(target, others, qlooFor(), env, k, CATALOG.shows.find((s) => s.id === target.id)?.origin ?? null);
    return { status: 200, body };
  }
  if (req.action === 'backtest') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(req.cutoff)) return { status: 400, body: { error: 'cutoff must be YYYY-MM-DD' } };
    const qloo = qlooFor();
    const result = await runBacktest({
      target,
      others,
      cutoff: new Date(req.cutoff).toISOString(),
      horizonMonths: req.horizonMonths,
      qlooArm: {
        label: qloo.mode === 'LIVE' ? 'With Qloo (live API)' : 'With Qloo (MOCK — pipeline test only)',
        labelEs: qloo.mode === 'LIVE' ? 'Con Qloo (API real)' : 'Con Qloo (MOCK — solo prueba del circuito)',
        adapter: qloo,
      },
    });
    return { status: 200, body: result };
  }
  return { status: 400, body: { error: 'Unknown action' } };
}

// ------------------------------------------------------------------ private LIVE endpoint
export type LiveRequest =
  | ApiRequest
  | { action: 'status' }
  | { action: 'diagnose'; test: 'auth' | 't2' | 't4' | 't5'; showId?: string; cutoff?: string }
  /** Four controlled arms on the same data: A baseline, B +discovery, C +affinity, D both. */
  | { action: 'compare'; showId: string; k?: number }
  /** Blind editorial set (Qloo-admitted vs baseline) for independent raters; the key is returned separately. */
  | { action: 'editorial'; showId: string }
  /** LIVE analysis of a show found through the open search (feed URL). */
  | { action: 'analyze'; feedUrl: string; appleUrl?: string | null; host?: string | null }
  /** Operator controls for the PUBLIC LIVE path (/api/discover): usage and emergency pause. */
  | { action: 'public-usage' }
  | { action: 'public-pause'; note?: string }
  | { action: 'public-resume' };

const quota = new HourlyQuota();

/**
 * Private endpoint (/api/live). Order of checks: configured → valid token → switch on → quota.
 * Responses carry aggregate numbers and our own (RSS) names only: no Qloo entity data beyond what
 * the normal recommendation view shows, and never the key.
 */
export async function handleLive(req: LiveRequest, env: Env & PublicEnv, authorization: string | null | undefined, deps: { store?: CasStore | null } = {}): Promise<{ status: number; body: unknown }> {
  if (!env.LIVE_ACCESS_TOKEN_SHA256) return { status: 503, body: { error: 'Private LIVE testing is not configured.' } };
  const tokenId = verifyBearer(authorization, env);
  if (!tokenId) return { status: 401, body: { error: 'Missing or invalid access token.' } };
  // Public-path controls work even when private LIVE is switched off (emergency pause must always work).
  if (req.action === 'public-usage' || req.action === 'public-pause' || req.action === 'public-resume') {
    if (!deps.store) return { status: 503, body: { error: 'Shared usage store unavailable.' } };
    const guard = new PublicGuard(deps.store, publicConfig(env));
    if (req.action === 'public-pause') return { status: 200, body: { control: await guard.setPaused(true, typeof req.note === 'string' ? req.note.slice(0, 200) : null) } };
    if (req.action === 'public-resume') return { status: 200, body: { control: await guard.setPaused(false, null) } };
    return { status: 200, body: { publicEnabled: env.QLOO_PUBLIC_ENABLED === 'true' && Boolean(env.QLOO_API_KEY), control: await guard.control(), usage: await guard.usage() } };
  }
  const sw = liveSwitch(env);
  if (!sw.on) return { status: 403, body: { error: 'LIVE is switched off; requests stay in MOCK.', reason: sw.reason, mode: 'MOCK' } };
  if (req.action === 'status') {
    return { status: 200, body: { mode: 'LIVE', limits: { analysis: limitsFromEnv(env), diagnostic: limitsFromEnv(env, 'diagnostic') }, baseUrl: env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com' } };
  }
  const maxPerHour = Math.max(1, Number(env.LIVE_MAX_ANALYSES_PER_HOUR) || 20);
  const q = quota.take(tokenId, maxPerHour);
  if (!q.ok) return { status: 429, body: { error: `Hourly limit of ${maxPerHour} LIVE requests reached.`, retryAfterS: q.retryAfterS } };

  const kind = req.action === 'diagnose' || req.action === 'compare' ? 'diagnostic' : 'analysis';
  const limits = limitsFromEnv(env, kind);
  const budget = { networkCalls: 0, startedAt: Date.now() };
  const adapters: LiveQlooAdapter[] = [];
  const make = () => {
    const a = makeQloo(env, limits, budget);
    if (a instanceof LiveQlooAdapter) adapters.push(a);
    return a;
  };
  const metrics = () => {
    const all = adapters.map((a) => summarizeMetrics(a.metrics));
    const sum = (f: (m: (typeof all)[number]) => number) => all.reduce((s, m) => s + f(m), 0);
    const statuses: Record<string, number> = {};
    const errors: Record<string, number> = {};
    for (const m of all) {
      for (const [k, v] of Object.entries(m.statuses)) statuses[k] = (statuses[k] ?? 0) + v;
      for (const [k, v] of Object.entries(m.errors)) errors[k] = (errors[k] ?? 0) + v;
    }
    const lat = adapters.flatMap((a) => a.metrics.latenciesMs).sort((a, b) => a - b);
    const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);
    return { networkCalls: sum((m) => m.networkCalls), cacheHits: sum((m) => m.cacheHits), retries: sum((m) => m.retries), statuses, errors, maxInFlight: Math.max(0, ...all.map((m) => m.maxInFlight)), p50Ms: pct(0.5), p95Ms: pct(0.95), elapsedMs: Date.now() - budget.startedAt, limits, quotaRemaining: q.remaining };
  };

  try {
    if (req.action === 'analyze') {
      const { handlePodcasts } = await import('./podcasts-api');
      const r = await handlePodcasts(req, env, {}, make);
      return { status: r.status, body: r.body && typeof r.body === 'object' ? { ...(r.body as object), qlooMetrics: metrics() } : r.body };
    }
    if (req.action === 'editorial') {
      const target = DATASETS.find((d) => d.id === req.showId);
      if (!target) return { status: 404, body: { error: `Unknown show ${req.showId}` } };
      const others = DATASETS.filter((d) => d.id !== target.id);
      const baseline = await runAgent({ target, others, qloo: new NoQlooAdapter(), k: 10, originOf: ORIGIN_OF });
      const enriched = await runAgent({ target, others, qloo: make(), k: 10, originOf: ORIGIN_OF, verifier: makeVerifier(env) });
      // Same Wikidata lookup for every name, baseline and Qloo alike (no provenance in the descriptions).
      const names = blindNames(baseline, enriched);
      const checks = await new WikidataVerifier({ fetchJson: (u) => safeJson(u, { allowHosts: WIKI_HOSTS, timeoutMs: 5000 }), maxCandidates: Math.min(names.length, 30) }).verify(names.map((n) => ({ entity: { entityId: `blind:${nameKey(n)}`, name: n } })), { targetLang: target.language });
      const descriptions = Object.fromEntries(checks.filter((c) => c.status === 'documented').map((c) => [nameKey(c.name), c.description.en ?? c.description.es ?? null]));
      const { items, key } = buildBlindSet({ id: target.id, name: target.name }, baseline, enriched, descriptions);
      return {
        status: 200,
        body: {
          instructions: 'Give ONLY sheetCsv and rubric to the raters. Keep key private until all ratings are in.',
          sheetCsv: blindSheetCsv(items),
          rubric: BLIND_RUBRIC,
          key: { ...key, sheetSha256: sha256(blindSheetCsv(items)) },
          qlooMetrics: metrics(),
        },
      };
    }
    if (req.action === 'compare') {
      const target = DATASETS.find((d) => d.id === req.showId);
      if (!target) return { status: 404, body: { error: `Unknown show ${req.showId}` } };
      const others = DATASETS.filter((d) => d.id !== target.id);
      const k = Math.min(Math.max(req.k ?? 5, 1), 10);
      const verifier = makeVerifier(env);
      // Arms share the private Qloo cache, so repeated lookups are not paid twice.
      const arm = (qloo: QlooAdapter, discovery: boolean, affinity: boolean) => runAgent({ target, others, qloo, k, originOf: ORIGIN_OF, qlooDiscovery: discovery, qlooAffinity: affinity, verifier: discovery ? verifier : undefined });
      const A = await arm(new NoQlooAdapter(), false, false);
      const B = await arm(make(), true, false);
      const C = await arm(make(), false, true);
      const D = await arm(make(), true, true);
      return { status: 200, body: { showId: target.id, ...compareArms({ A, B, C, D }), qlooMetrics: metrics() } };
    }
    if (req.action !== 'diagnose') {
      const r = await runAction(req, env, make);
      return { status: r.status, body: r.body && typeof r.body === 'object' ? { ...(r.body as object), qlooMetrics: metrics() } : r.body };
    }
    const showId = req.showId ?? 'diary-of-a-ceo';
    if (!DATASETS.some((d) => d.id === showId)) return { status: 404, body: { error: `Unknown show ${showId}` } };
    if (req.test === 'auth') {
      // Uncached on purpose: this must prove the key works now.
      const a = new LiveQlooAdapter({ apiKey: env.QLOO_API_KEY!, baseUrl: env.QLOO_BASE_URL, limits, sharedBudget: budget });
      adapters.push(a);
      let hits;
      try {
        hits = await a.searchPerson('Lex Fridman');
      } catch (err) {
        if (!(err instanceof QlooError)) throw err;
        return { status: 200, body: { test: 'auth', authenticated: false, kind: err.kind, qlooStatus: err.status, error: redact(err.message, env.QLOO_API_KEY), qlooMetrics: metrics() } };
      }
      const lex = hits.find((h) => h.name === 'Lex Fridman');
      let affinityField: boolean | null = null;
      if (lex) affinityField = (await a.personInsights({ signalIds: [lex.entityId], excludeIds: [lex.entityId], take: 3 })).some((e) => e.affinity !== undefined);
      return { status: 200, body: { test: 'auth', authenticated: true, searchResults: hits.length, knownPersonFound: Boolean(lex), affinityField, qlooMetrics: metrics() } };
    }
    if (req.test === 't2') {
      const s = summarizeCoverage(await runCoverage(make(), DATASETS, [], [showId]));
      return { status: 200, body: { test: 't2', showId, overall: s.overall, byRole: s.byRole, ambiguousGuests: s.ambiguous.map((x) => x.name), mismatchedGuests: s.mismatches.map((x) => x.name), qlooMetrics: metrics() } };
    }
    if (req.test === 't4') {
      const [r] = await runOriginality(make(), DATASETS, [showId]);
      return {
        status: 200,
        body: { test: 't4', showId, signals: r.signalCount, returned: r.returned, alreadyGuests: r.alreadyGuests.length, inOurTop25: r.inOurTop25.length, elsewhereInOurFeeds: r.inVerifiedPool.length, newToUs: r.newToUs.length, medianPopularity: r.medianPopularity, culturalHooks: r.culturalHooks, qlooMetrics: metrics() },
      };
    }
    const cutoff = req.cutoff ?? '2025-01-01';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return { status: 400, body: { error: 'cutoff must be YYYY-MM-DD' } };
    const cells = await runComparison(make, DATASETS, [cutoff], [showId]);
    return { status: 200, body: { test: 't5', showId, cutoff, cells, summary: summarizeComparison(cells, 10), leakage: 'Qloo graph is current: agreement with today’s graph, not a leakage-free prediction.', qlooMetrics: metrics() } };
  } catch (err) {
    const msg = redact(err instanceof Error ? err.message : String(err), env.QLOO_API_KEY);
    const status = err instanceof QlooError ? (err.kind === 'http' && err.status === 401 ? 502 : err.kind === 'budget' || err.kind === 'deadline' ? 504 : 502) : 500;
    return { status, body: { error: msg, kind: err instanceof QlooError ? err.kind : 'internal', qlooStatus: err instanceof QlooError ? err.status : null, qlooMetrics: metrics() } };
  }
}
