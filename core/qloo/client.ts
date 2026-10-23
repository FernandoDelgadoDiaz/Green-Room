// LIVE adapter for the Qloo hackathon API. Server-side only: the key comes from QLOO_API_KEY and is
// sent in the X-Api-Key header (developer guide). Never import this file from browser code.

import { QlooError, type InsightsEntityType, type QlooAdapter, type QlooCall, type QlooEntity } from './types';

export const QLOO_HACKATHON_BASE_URL = 'https://hackathon.api.qloo.com';

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}>;

export interface LiveQlooOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
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
  const entityId = typeof r.entity_id === 'string' ? r.entity_id : typeof r.id === 'string' ? r.id : null;
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
      : [];
  return list.map(parseEntity).filter((e): e is QlooEntity => e !== null);
}

export class LiveQlooAdapter implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: LiveQlooOptions) {
    if (!opts.apiKey) throw new QlooError('QLOO_API_KEY is not set', null);
    this.baseUrl = opts.baseUrl || QLOO_HACKATHON_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private async get(path: string, params: Record<string, string>): Promise<QlooEntity[]> {
    const started = Date.now();
    const url = buildUrl(this.baseUrl, path, params);
    try {
      const res = await this.fetchImpl(url, { headers: { 'X-Api-Key': this.opts.apiKey, Accept: 'application/json' } });
      if (res.status === 404) {
        this.calls.push({ endpoint: path, params, status: 404, ms: Date.now() - started, resultCount: 0, note: 'no results' });
        return [];
      }
      if (!res.ok) {
        this.calls.push({ endpoint: path, params, status: res.status, ms: Date.now() - started, resultCount: 0 });
        throw new QlooError(`Qloo ${path} returned HTTP ${res.status}`, res.status);
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
      return entities;
    } catch (err) {
      if (err instanceof QlooError) throw err;
      this.calls.push({ endpoint: path, params, status: 'error', ms: Date.now() - started, resultCount: 0, note: String(err) });
      throw new QlooError(`Qloo ${path} request failed: ${String(err)}`, null);
    }
  }

  searchPerson(name: string) {
    // take=5, like the official harness, so namesakes are visible and can be treated as ambiguous.
    return this.get('/search', { query: name, types: 'urn:entity:person', take: '5' });
  }

  personInsights({ signalIds, excludeIds, take, popularityMax }: { signalIds: string[]; excludeIds: string[]; take: number; popularityMax?: number }) {
    return this.get('/v2/insights', {
      'filter.type': 'urn:entity:person',
      'signal.interests.entities': signalIds.join(','),
      'filter.exclude.entities': excludeIds.join(','),
      'filter.popularity.max': popularityMax === undefined ? '' : String(popularityMax),
      take: String(Math.min(take, 50)),
    });
  }

  async affinityFor({ signalIds, candidateIds }: { signalIds: string[]; candidateIds: string[] }) {
    const out = new Map<string, number>();
    for (let i = 0; i < candidateIds.length; i += 50) {
      const batch = candidateIds.slice(i, i + 50);
      const entities = await this.get('/v2/insights', {
        'filter.type': 'urn:entity:person',
        'signal.interests.entities': signalIds.join(','),
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
      const last = this.calls[this.calls.length - 1];
      if (last) last.note = `affinity values: ${withAffinity}${last.note ? `; ${last.note}` : ''}`;
    }
    return out;
  }

  categoryInsights({ signalIds, type, take }: { signalIds: string[]; type: InsightsEntityType; take: number }) {
    return this.get('/v2/insights', {
      'filter.type': type,
      'signal.interests.entities': signalIds.join(','),
      take: String(Math.min(take, 50)),
    });
  }
}
