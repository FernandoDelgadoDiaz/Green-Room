// LIVE adapter for the Qloo hackathon API. Server-side only: the key comes from QLOO_API_KEY and is
// sent in the X-Api-Key header (developer guide). Never import this file from browser code.

import { QlooError, type InsightsEntityType, type QlooAdapter, type QlooCall, type QlooEntity } from './types';

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
  /** Extra attempts for 429/5xx/network errors (bounded by the deadline). */
  retries: number;
}

export const DEFAULT_LIMITS: QlooLimits = { maxCalls: 80, concurrency: 6, timeoutMs: 8000, deadlineMs: 45000, retries: 1 };

export interface LiveQlooOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  limits?: Partial<QlooLimits>;
  /** Shared, private, server-side response cache (allowed by the developer guide). */
  cache?: Map<string, { at: number; entities: QlooEntity[]; status: number }>;
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
  const description = [props.short_description, props.description, r.disambiguation].find((d): d is string => typeof d === 'string' && d.length > 0);
  return {
    entityId,
    name,
    type: typeof r.type === 'string' ? r.type : Array.isArray(r.types) && typeof r.types[0] === 'string' ? (r.types[0] as string) : undefined,
    popularity: num(r.popularity),
    affinity: num(query.affinity) ?? num(r.affinity),
    tags,
    ...(description ? { description } : {}),
  };
}

/** /search returns results: Entity[]; /v2/insights returns results.entities: Entity[]. */
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
  readonly metrics: QlooMetrics = { networkCalls: 0, cacheHits: 0, retries: 0, errors: {}, statuses: {}, maxInFlight: 0, latenciesMs: [], startedAt: Date.now() };
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly opts: LiveQlooOptions) {
    if (!opts.apiKey) throw new QlooError('QLOO_API_KEY is not set', null, 'config');
    this.baseUrl = opts.baseUrl || QLOO_HACKATHON_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.limits = { ...DEFAULT_LIMITS, ...Object.fromEntries(Object.entries(opts.limits ?? {}).filter(([, v]) => v !== undefined && Number.isFinite(v))) };
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inFlight >= this.limits.concurrency) await new Promise<void>((r) => this.waiting.push(r));
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
    const started = Date.now();
    const url = buildUrl(this.baseUrl, path, params);
    const ttl = this.opts.cacheTtlMs ?? 3600_000;
    const hit = this.opts.cache?.get(url);
    if (hit && Date.now() - hit.at < ttl) {
      this.metrics.cacheHits++;
      this.calls.push({ endpoint: path, params, status: hit.status, ms: 0, resultCount: hit.entities.length, note: 'cache' });
      return hit.entities;
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
          const retryable = res.status === 429 || res.status >= 500;
          if (retryable && attemptNo < this.limits.retries) {
            this.metrics.retries++;
            const ra = Number(res.headers?.get('retry-after'));
            await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attemptNo, 2000)));
            continue;
          }
          if (res.status === 404) {
            this.calls.push({ endpoint: path, params, status: 404, ms: Date.now() - started, resultCount: 0, note: 'no results' });
            this.opts.cache?.set(url, { at: Date.now(), entities: [], status: 404 });
            return [];
          }
          if (!res.ok) {
            this.fail(`http_${res.status}`);
            this.calls.push({ endpoint: path, params, status: res.status, ms: Date.now() - started, resultCount: 0 });
            throw new QlooError(`Qloo ${path} returned HTTP ${res.status}`, res.status, 'http');
          }
          const entities = parseEntities(await res.json());
          // The API silently ignores invalid params and answers 200 with no entities (developer guide).
          this.calls.push({
            endpoint: path,
            params,
            status: res.status,
            ms: Date.now() - started,
            resultCount: entities.length,
            note: entities.length === 0 ? 'empty 200: check params against the Entity Type Parameter Guide' : undefined,
          });
          this.opts.cache?.set(url, { at: Date.now(), entities, status: res.status });
          return entities;
        }
      });
    } catch (err) {
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

  categoryInsights({ signalIds, tagIds = [], type, take }: { signalIds: string[]; tagIds?: string[]; type: InsightsEntityType; take: number }) {
    return this.get('/v2/insights', {
      'filter.type': type,
      'signal.interests.entities': signalIds.join(','),
      'signal.interests.tags': tagIds.join(','),
      take: String(Math.min(take, 50)),
    });
  }
}
