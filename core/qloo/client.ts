// LIVE adapter for the Qloo hackathon API. Server-side only: the key comes from QLOO_API_KEY and is
// sent in the X-Api-Key header (developer guide). Never import this file from browser code.

import { QlooError, type Demographics, type InsightsEntityType, type QlooAdapter, type QlooCall, type QlooEntity, type Trend } from './types';

export const QLOO_HACKATHON_BASE_URL = 'https://hackathon.api.qloo.com';

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface QlooLimits {
  /** Hard cap on network calls for this adapter (one analysis). Cached answers do not count. */
  maxCalls: number;
  /** Requests in flight at the same time. */
  concurrency: number;
  /** Per-request timeout. */
  timeoutMs: number;
  /** Wall-clock budget for the whole analysis; no new request starts after it. */
  deadlineMs: number;
  /** Extra attempts for 5xx/network errors (bounded by the deadline). */
  retries: number;
  /** Extra attempts for HTTP 429 (default: `retries`). Each one is a real call and counts in maxCalls. */
  retries429?: number;
  /** Minimum spacing between request starts, so bursts do not trip Qloo's rate limit (default 0). */
  minIntervalMs?: number;
  /** Longest wait honored from a Retry-After header (default 2 s; bounded by the deadline). */
  maxRetryWaitMs?: number;
}

export const DEFAULT_LIMITS: QlooLimits = { maxCalls: 80, concurrency: 6, timeoutMs: 8000, deadlineMs: 45000, retries: 1 };

export interface LiveQlooOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  limits?: Partial<QlooLimits>;
  /** Shared, private, server-side response cache (allowed by the developer guide). */
  cache?: Map<string, { at: number; entities: QlooEntity[]; status: number; raw?: unknown }>;
  cacheTtlMs?: number;
  /** Lets several adapters (e.g. the two arms of a backtest) draw from one call and time budget. */
  sharedBudget?: { networkCalls: number; startedAt: number };
}

export interface QlooMetrics {
  networkCalls: number;
  cacheHits: number;
  retries: number;
  errors: Record<string, number>;
  statuses: Record<string, number>;
  maxInFlight: number;
  latenciesMs: number[];
  startedAt: number;
  /** Requests that finally failed (after any retries): answers the analysis really lost. */
  lost?: number;
}

export function summarizeMetrics(m: QlooMetrics) {
  const l = [...m.latenciesMs].sort((a, b) => a - b);
  const q = (p: number) => (l.length ? l[Math.min(l.length - 1, Math.floor(p * l.length))] : null);
  return { networkCalls: m.networkCalls, cacheHits: m.cacheHits, retries: m.retries, errors: m.errors, statuses: m.statuses, maxInFlight: m.maxInFlight, p50Ms: q(0.5), p95Ms: q(0.95), elapsedMs: Date.now() - m.startedAt };
}

export function buildUrl(baseUrl: string, path: string, params: Record<string, string>): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [k, v] of Object.entries(params)) if (v !== '') url.searchParams.set(k, v);
  return url.toString();
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Accepts the documented entity shape and close variants; returns null for anything without id+name. */
export function parseEntity(raw: unknown): QlooEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const entityId = typeof r.entity_id === 'string' ? r.entity_id : typeof r.id === 'string' ? r.id : typeof r.tag_id === 'string' ? r.tag_id : null;
  const name = typeof r.name === 'string' ? r.name : null;
  if (!entityId || !name) return null;
  const query = (r.query && typeof r.query === 'object' ? r.query : {}) as Record<string, unknown>;
  const tags = Array.isArray(r.tags)
    ? (r.tags as unknown[]).map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>).name : t)).filter((t): t is string => typeof t === 'string')
    : undefined;
  const props = (r.properties && typeof r.properties === 'object' ? r.properties : {}) as Record<string, unknown>;
  // Top-level short_description/description first, then properties (same order as the official harness).
  const description = [r.short_description, r.description, props.short_description, props.description, r.disambiguation].find((d): d is string => typeof d === 'string' && d.length > 0);
  // Qloo sends a generic `type` ("urn:entity") and the specific kind in `subtype` ("urn:entity:person");
  // the official harness reads `subtype || type`. Keep every type seen, specific ones first.
  const types = [...new Set([r.subtype, ...(Array.isArray(r.types) ? (r.types as unknown[]) : []), r.type].filter((x): x is string => typeof x === 'string' && x.length > 0))].sort(
    (a, b) => Number(a === 'urn:entity') - Number(b === 'urn:entity'),
  );
  // Tolerant: external.wikidata may be a list of {id} objects or of strings.
  const ext = (r.external && typeof r.external === 'object' ? (r.external as Record<string, unknown>).wikidata : undefined) as unknown;
  const wikidataIds = (Array.isArray(ext) ? ext : ext ? [ext] : [])
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>).id : x))
    .filter((x): x is string => typeof x === 'string' && /^Q\d+$/.test(x));
  return {
    entityId,
    name,
    type: types[0],
    popularity: num(r.popularity),
    affinity: num(query.affinity) ?? num(r.affinity),
    tags,
    ...(description ? { description } : {}),
    ...(types.length ? { types } : {}),
    ...(wikidataIds.length ? { wikidataIds } : {}),
  };
}

/** /search returns results: Entity[]; /v2/insights returns results.entities: Entity[]. */
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Structure of a response without its values (keys, types, array lengths): a safe diagnostic note. */
export function shapeOf(v: unknown, depth = 0): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.length}${v.length && depth < 4 ? ` × ${shapeOf(v[0], depth + 1)}` : ''}]`;
  if (typeof v === 'object') {
    if (depth >= 4) return '{…}';
    return `{${Object.entries(v as Record<string, unknown>).slice(0, 12).map(([k, x]) => `${k}:${shapeOf(x, depth + 1)}`).join(',')}}`;
  }
  return typeof v;
}

/** results.demographics[] → id → {age, gender}. Unknown shapes give an empty map, never an error. */
export function parseDemographics(body: unknown): Map<string, Demographics> {
  const out = new Map<string, Demographics>();
  const list = (body as { results?: { demographics?: unknown } } | null)?.results?.demographics;
  if (!Array.isArray(list)) return out;
  for (const d of list as Array<{ entity_id?: string; query?: { age?: Record<string, unknown>; gender?: Record<string, unknown> } }>) {
    if (!d?.entity_id || !d.query) continue;
    const pick = (o: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, numOrNull(v)]).filter((e): e is [string, number] => e[1] !== null));
    const age = pick(d.query.age);
    const gender = pick(d.query.gender);
    if (Object.keys(age).length || Object.keys(gender).length) out.set(d.entity_id, { age, gender });
  }
  return out;
}

/**
 * The trending response is read defensively: the weekly points are the first array of objects
 * carrying a date and a percentile, rank or velocity (Get Trending Data). Unknown shapes → null.
 */
export function parseTrend(body: unknown, entityId: string): Trend | null {
  type Row = Record<string, unknown>;
  const isPoint = (r: unknown): r is Row => Boolean(r) && typeof r === 'object' && Object.keys(r as Row).some((k) => /date|week/i.test(k)) && Object.keys(r as Row).some((k) => /percentile|velocity|rank/i.test(k));
  const find = (v: unknown, depth = 0): Row[] | null => {
    if (depth > 6 || !v || typeof v !== 'object') return null;
    if (Array.isArray(v)) {
      if (v.length && v.every(isPoint)) return v as Row[];
      // A list of per-entity objects: prefer the one for this entity.
      const own = v.find((x) => x && typeof x === 'object' && Object.values(x as Row).includes(entityId));
      for (const x of own ? [own, ...v] : v) {
        const f = find(x, depth + 1);
        if (f) return f;
      }
      return null;
    }
    for (const x of Object.values(v as Row)) {
      const f = find(x, depth + 1);
      if (f) return f;
    }
    return null;
  };
  const rows = find(body);
  if (!rows?.length) return null;
  const field = (r: Row, re: RegExp) => numOrNull(Object.entries(r).find(([k]) => re.test(k))?.[1]);
  const points = rows
    .map((r) => ({ date: String(Object.entries(r).find(([k]) => /date|week/i.test(k))?.[1] ?? ''), percentile: field(r, /percentile/i), velocity: field(r, /velocity/i) }))
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return null;
  const withPct = points.filter((p) => p.percentile !== null);
  const first = withPct[0]?.percentile ?? null;
  const last = withPct[withPct.length - 1]?.percentile ?? null;
  const recentVelocity = points.slice(-4).map((p) => p.velocity).filter((v): v is number => v !== null);
  const v = recentVelocity.length ? recentVelocity.reduce((a, b) => a + b, 0) / recentVelocity.length : null;
  const change = first !== null && last !== null ? last - first : null;
  // Percentiles are 0–1 or 0–100 depending on the field; a change of 5 % of the scale counts.
  const scale = last !== null && last > 1 ? 100 : 1;
  const direction: Trend['direction'] = change !== null ? (change > 0.05 * scale ? 'rising' : change < -0.05 * scale ? 'falling' : 'steady') : v !== null ? (v > 0 ? 'rising' : v < 0 ? 'falling' : 'steady') : 'steady';
  return { points, direction, latestPercentile: last === null ? null : scale === 100 ? last / 100 : last };
}

export function parseEntities(body: unknown): QlooEntity[] {
  if (!body || typeof body !== 'object') return [];
  const results = (body as Record<string, unknown>).results;
  const list = Array.isArray(results)
    ? results
    : results && typeof results === 'object' && Array.isArray((results as Record<string, unknown>).entities)
      ? ((results as Record<string, unknown>).entities as unknown[])
      : results && typeof results === 'object' && Array.isArray((results as Record<string, unknown>).tags)
        ? ((results as Record<string, unknown>).tags as unknown[])
        : [];
  return list.map(parseEntity).filter((e): e is QlooEntity => e !== null);
}

export class LiveQlooAdapter implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  readonly limits: QlooLimits;
  readonly metrics: QlooMetrics = { networkCalls: 0, cacheHits: 0, retries: 0, errors: {}, statuses: {}, maxInFlight: 0, latenciesMs: [], startedAt: Date.now(), lost: 0 };
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];
  /** Adaptive concurrency: halved on every 429, raised back one step after a run of successes. */
  private cap: number;
  private okStreak = 0;
  /** Rate gate shared by every request of this adapter: spacing between starts and 429 cool-down. */
  private nextStartAt = 0;
  private cooldownUntil = 0;

  constructor(private readonly opts: LiveQlooOptions) {
    if (!opts.apiKey) throw new QlooError('QLOO_API_KEY is not set', null, 'config');
    this.baseUrl = opts.baseUrl || QLOO_HACKATHON_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.limits = { ...DEFAULT_LIMITS, ...Object.fromEntries(Object.entries(opts.limits ?? {}).filter(([, v]) => v !== undefined && Number.isFinite(v))) };
    this.cap = this.limits.concurrency;
  }

  /** Qloo calls still allowed for this analysis (the agent uses it to skip optional steps in time). */
  budgetLeft(): number {
    return Math.max(0, this.limits.maxCalls - (this.opts.sharedBudget ?? this.metrics).networkCalls);
  }

  /** Waits for the rate gate: minimum spacing between starts and any 429 cool-down. */
  private async pace() {
    const now = Date.now();
    const at = Math.max(now, this.nextStartAt, this.cooldownUntil);
    this.nextStartAt = at + (this.limits.minIntervalMs ?? 0);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  private throttled(waitMs: number) {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + waitMs);
    this.cap = Math.max(1, Math.floor(this.cap / 2));
    this.okStreak = 0;
  }

  private succeeded() {
    if (++this.okStreak >= 8 && this.cap < this.limits.concurrency) ((this.cap += 1), (this.okStreak = 0));
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.inFlight >= this.cap) await new Promise<void>((r) => this.waiting.push(r));
    this.inFlight++;
    this.metrics.maxInFlight = Math.max(this.metrics.maxInFlight, this.inFlight);
    try {
      return await fn();
    } finally {
      this.inFlight--;
      this.waiting.shift()?.();
    }
  }

  private fail(kind: string) {
    this.metrics.errors[kind] = (this.metrics.errors[kind] ?? 0) + 1;
  }

  /** One HTTP attempt with timeout. Returns the response or throws a typed QlooError. */
  private async attempt(url: string, path: string) {
    const budget = this.opts.sharedBudget ?? this.metrics;
    if (budget.networkCalls >= this.limits.maxCalls) {
      this.fail('budget');
      throw new QlooError(`Qloo call budget reached (${this.limits.maxCalls} per analysis)`, null, 'budget');
    }
    const remaining = this.limits.deadlineMs - (Date.now() - budget.startedAt);
    if (remaining <= 0) {
      this.fail('deadline');
      throw new QlooError(`Analysis time budget reached (${this.limits.deadlineMs} ms)`, null, 'deadline');
    }
    await this.pace();
    if (budget.networkCalls >= this.limits.maxCalls) {
      this.fail('budget');
      throw new QlooError(`Qloo call budget reached (${this.limits.maxCalls} per analysis)`, null, 'budget');
    }
    this.metrics.networkCalls++;
    if (this.opts.sharedBudget) this.opts.sharedBudget.networkCalls++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(this.limits.timeoutMs, remaining));
    const t0 = Date.now();
    try {
      const res = await this.fetchImpl(url, { headers: { 'X-Api-Key': this.opts.apiKey, Accept: 'application/json' }, signal: ctrl.signal });
      this.metrics.latenciesMs.push(Date.now() - t0);
      this.metrics.statuses[res.status] = (this.metrics.statuses[res.status] ?? 0) + 1;
      return res;
    } catch (err) {
      const kind = ctrl.signal.aborted ? 'timeout' : 'network';
      this.fail(kind);
      // String(err) never contains the key: it travels only in a header.
      throw new QlooError(`Qloo ${path} ${kind === 'timeout' ? 'timed out' : `request failed: ${String(err)}`}`, null, kind);
    } finally {
      clearTimeout(timer);
    }
  }

  private async get(path: string, params: Record<string, string>): Promise<QlooEntity[]> {
    return (await this.request(path, params, false)).entities;
  }

  /** Same pacing, budget, retries and cache as get(), returning the parsed JSON body (null on 404). */
  private async getJson(path: string, params: Record<string, string>): Promise<unknown> {
    return (await this.request(path, params, true)).raw ?? null;
  }

  private async request(path: string, params: Record<string, string>, keepRaw: boolean): Promise<{ entities: QlooEntity[]; raw?: unknown }> {
    const started = Date.now();
    const url = buildUrl(this.baseUrl, path, params);
    const ttl = this.opts.cacheTtlMs ?? 3600_000;
    const hit = this.opts.cache?.get(url);
    if (hit && Date.now() - hit.at < ttl) {
      this.metrics.cacheHits++;
      this.calls.push({ endpoint: path, params, status: hit.status, ms: 0, resultCount: hit.entities.length, note: 'cache' });
      return { entities: hit.entities, raw: hit.raw };
    }
    try {
      return await this.slot(async () => {
        for (let attemptNo = 0; ; attemptNo++) {
          const res = await this.attempt(url, path).catch((err: QlooError) => {
            if ((err.kind === 'network' || err.kind === 'timeout') && attemptNo < this.limits.retries) return null;
            throw err;
          });
          if (!res) {
            this.metrics.retries++;
            continue;
          }
          const ra = Number(res.headers?.get('retry-after'));
          const wait = Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attemptNo, this.limits.maxRetryWaitMs ?? 2000);
          if (res.status === 429) this.throttled(wait); // every request of this analysis backs off, not just this one
          else if (res.ok) this.succeeded();
          const maxRetries = res.status === 429 ? (this.limits.retries429 ?? this.limits.retries) : this.limits.retries;
          const retryable = res.status === 429 || res.status >= 500;
          const timeLeft = this.limits.deadlineMs - (Date.now() - (this.opts.sharedBudget ?? this.metrics).startedAt);
          if (retryable && attemptNo < maxRetries && this.budgetLeft() > 0 && timeLeft > wait + 1000) {
            this.metrics.retries++;
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          if (res.status === 404) {
            this.calls.push({ endpoint: path, params, status: 404, ms: Date.now() - started, resultCount: 0, note: 'no results' });
            this.opts.cache?.set(url, { at: Date.now(), entities: [], status: 404 });
            return { entities: [] };
          }
          if (!res.ok) {
            this.fail(`http_${res.status}`);
            this.calls.push({ endpoint: path, params, status: res.status, ms: Date.now() - started, resultCount: 0 });
            throw new QlooError(`Qloo ${path} returned HTTP ${res.status}`, res.status, 'http');
          }
          const body = await res.json();
          const entities = keepRaw ? [] : parseEntities(body);
          // The API silently ignores invalid params and answers 200 with no entities (developer guide).
          this.calls.push({
            endpoint: path,
            params,
            status: res.status,
            ms: Date.now() - started,
            resultCount: keepRaw ? 1 : entities.length,
            note: !keepRaw && entities.length === 0 ? 'empty 200: check params against the Entity Type Parameter Guide' : undefined,
          });
          this.opts.cache?.set(url, { at: Date.now(), entities, status: res.status, ...(keepRaw ? { raw: body } : {}) });
          return { entities, ...(keepRaw ? { raw: body } : {}) };
        }
      });
    } catch (err) {
      this.metrics.lost = (this.metrics.lost ?? 0) + 1;
      if (err instanceof QlooError) {
        if (err.kind !== 'http') this.calls.push({ endpoint: path, params, status: 'error', ms: Date.now() - started, resultCount: 0, note: err.message });
        throw err;
      }
      this.calls.push({ endpoint: path, params, status: 'error', ms: Date.now() - started, resultCount: 0, note: String(err) });
      throw new QlooError(`Qloo ${path} request failed: ${String(err)}`, null, 'network');
    }
  }

  searchPerson(name: string) {
    // take=5, like the official harness, so namesakes are visible and can be treated as ambiguous.
    return this.get('/search', { query: name, types: 'urn:entity:person', take: '5' });
  }

  searchPodcast(name: string) {
    return this.get('/search', { query: name, types: 'urn:entity:podcast', take: '5' });
  }

  /** Same request as the official harness's tag resolver (filter.query + feature.semantic_search). */
  findTags(query: string) {
    return this.get('/v2/tags', { 'filter.query': query, 'feature.semantic_search': 'true', take: '10' });
  }

  personInsights({ signalIds, tagIds = [], excludeIds, take, popularityMax }: { signalIds: string[]; tagIds?: string[]; excludeIds: string[]; take: number; popularityMax?: number }) {
    return this.get('/v2/insights', {
      'filter.type': 'urn:entity:person',
      'signal.interests.entities': signalIds.join(','),
      'signal.interests.tags': tagIds.join(','),
      'filter.exclude.entities': excludeIds.join(','),
      'filter.popularity.max': popularityMax === undefined ? '' : String(popularityMax),
      take: String(Math.min(take, 50)),
    });
  }

  async affinityFor({ signalIds, tagIds = [], candidateIds }: { signalIds: string[]; tagIds?: string[]; candidateIds: string[] }) {
    const out = new Map<string, number>();
    for (let i = 0; i < candidateIds.length; i += 50) {
      const batch = candidateIds.slice(i, i + 50);
      const entities = await this.get('/v2/insights', {
        'filter.type': 'urn:entity:person',
        'signal.interests.entities': signalIds.join(','),
        'signal.interests.tags': tagIds.join(','),
        // filter.results.entities restricts results to these ids (Entity Type Parameter Guide, person).
        // An unknown name such as filter.entities is silently ignored and would return arbitrary people.
        'filter.results.entities': batch.join(','),
        take: String(batch.length),
      });
      let withAffinity = 0;
      for (const e of entities) if (e.affinity !== undefined) {
        out.set(e.entityId, e.affinity);
        withAffinity++;
      }
      // Entities can come back without query.affinity; record how many carried a value.
      const ids = batch.join(',');
      const last = [...this.calls].reverse().find((c) => c.params['filter.results.entities'] === ids);
      if (last) last.note = `affinity values: ${withAffinity}${last.note ? `; ${last.note}` : ''}`;
    }
    return out;
  }

  /**
   * Demographic affinity (age, gender) for each entity and tag given (filter.type=urn:demographics).
   * Positive values: stronger-than-average alignment for that group (Qloo, Demographic Insights).
   */
  async demographics({ entityIds = [], tagIds = [] }: { entityIds?: string[]; tagIds?: string[] }): Promise<Map<string, Demographics>> {
    const body = await this.getJson('/v2/insights', {
      'filter.type': 'urn:demographics',
      'signal.interests.entities': entityIds.join(','),
      'signal.interests.tags': tagIds.join(','),
    });
    const m = parseDemographics(body);
    if (!m.size) this.noteShape(body);
    return m;
  }

  /** A 200 whose shape the parser did not recognize: record its structure (never its values). */
  private noteShape(body: unknown) {
    const last = this.calls[this.calls.length - 1];
    if (last && body !== null) last.note = `unrecognized shape: ${shapeOf(body).slice(0, 400)}`;
  }

  /** Weekly popularity trend of one entity (/v2/trending); null when Qloo has no series for it. */
  async trending({ entityId, type, start, end }: { entityId: string; type: InsightsEntityType; start: string; end: string }): Promise<Trend | null> {
    const body = await this.getJson('/v2/trending', {
      'filter.type': type,
      'signal.interests.entities': entityId,
      'filter.start_date': start,
      'filter.end_date': end,
    });
    const t = parseTrend(body, entityId);
    if (!t) this.noteShape(body);
    return t;
  }

  categoryInsights({ signalIds, tagIds = [], type, take }: { signalIds: string[]; tagIds?: string[]; type: InsightsEntityType; take: number }) {
    return this.get('/v2/insights', {
      'filter.type': type,
      'signal.interests.entities': signalIds.join(','),
      'signal.interests.tags': tagIds.join(','),
      take: String(Math.min(take, 50)),
    });
  }
}
