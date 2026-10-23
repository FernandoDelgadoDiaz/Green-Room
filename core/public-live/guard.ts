// Consumption guard for the PUBLIC Qloo LIVE path (/api/discover).
//
// Every limit lives in ONE shared document per UTC day, updated with compare-and-swap (ETag
// conditional writes in Netlify Blobs), so it holds across function instances:
//   - daily Qloo call budget: each fresh analysis reserves its worst case (the per-analysis call cap)
//     before running and settles to the real count after; a lease that is never settled (crash,
//     timeout) expires and its whole reservation counts as spent;
//   - global concurrency: at most N unexpired leases;
//   - per-visitor cap of fresh analyses per day (IP pseudonymized with a hash, never stored raw);
//   - a separate daily cap for feeds found through the open search;
//   - a pause flag that stops new Qloo calls immediately, without a redeploy.
// If the shared store cannot be read or written, the guard fails CLOSED (no Qloo call).

import { createHash } from 'node:crypto';

/** Minimal compare-and-swap store (implemented by Netlify Blobs in production, in memory in tests). */
export interface CasStore {
  get(key: string): Promise<{ data: unknown; etag: string } | null>;
  /** Returns false when the condition failed (someone else wrote first). */
  set(key: string, data: unknown, cond: { onlyIfMatch: string } | { onlyIfNew: true }): Promise<boolean>;
  /** Unconditional write (result cache, control flag). */
  put(key: string, data: unknown): Promise<void>;
}

export class MemoryCasStore implements CasStore {
  private readonly m = new Map<string, { data: string; etag: string }>();
  private n = 0;
  async get(key: string) {
    const v = this.m.get(key);
    return v ? { data: JSON.parse(v.data), etag: v.etag } : null;
  }
  async set(key: string, data: unknown, cond: { onlyIfMatch: string } | { onlyIfNew: true }) {
    const cur = this.m.get(key);
    if ('onlyIfNew' in cond ? cur : cur?.etag !== cond.onlyIfMatch) return false;
    this.m.set(key, { data: JSON.stringify(data), etag: `e${++this.n}` });
    return true;
  }
  async put(key: string, data: unknown) {
    this.m.set(key, { data: JSON.stringify(data), etag: `e${++this.n}` });
  }
}

export class GuardUnavailableError extends Error {}

/** Read-modify-write with retries on conflict. `fn` returns the new value, or null to leave it unchanged. */
export async function casUpdate<T>(store: CasStore, key: string, init: T, fn: (cur: T) => T | null, tries = 12): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const cur = await store.get(key);
    const value = (cur?.data as T | undefined) ?? structuredClone(init);
    const next = fn(structuredClone(value));
    if (next === null) return value;
    if (await store.set(key, next, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true })) return next;
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 60));
  }
  throw new GuardUnavailableError(`Could not update ${key}: too much contention`);
}

export interface PublicEnv {
  QLOO_PUBLIC_ENABLED?: string;
  PUBLIC_DAILY_QLOO_CALLS?: string;
  PUBLIC_CALLS_PER_ANALYSIS?: string;
  PUBLIC_MAX_CONCURRENT?: string;
  PUBLIC_FRESH_PER_IP_PER_DAY?: string;
  PUBLIC_OPEN_FEEDS_PER_DAY?: string;
  PUBLIC_CACHE_HOURS?: string;
  PUBLIC_PARTIAL_CACHE_HOURS?: string;
  PUBLIC_JOB_MAX_SECONDS?: string;
  PUBLIC_EXTERNAL_VERIFY_MAX?: string;
  PUBLIC_IP_SALT?: string;
}

export interface PublicConfig {
  dailyCalls: number;
  callsPerAnalysis: number;
  maxConcurrent: number;
  freshPerIpPerDay: number;
  openFeedsPerDay: number;
  cacheHours: number;
  /** Results with some lost Qloo answers are cached for less time, labeled partial. */
  partialCacheHours: number;
  /** Wall-clock budget of one background analysis (Qloo deadline plus verification and baseline). */
  jobMaxMs: number;
  /** Qloo proposals verified in Wikidata/Wikipedia per public analysis (free sources; time is the cost). */
  externalVerifyMax: number;
  /** A lease not settled after this long is considered dead (its reservation stays spent). */
  leaseMs: number;
}

const clamp = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

export function publicConfig(env: PublicEnv): PublicConfig {
  const jobMaxMs = clamp(env.PUBLIC_JOB_MAX_SECONDS, 240, 60, 840) * 1000;
  return {
    dailyCalls: clamp(env.PUBLIC_DAILY_QLOO_CALLS, 400, 0, 5000),
    callsPerAnalysis: clamp(env.PUBLIC_CALLS_PER_ANALYSIS, 80, 10, 150),
    maxConcurrent: clamp(env.PUBLIC_MAX_CONCURRENT, 2, 1, 5),
    freshPerIpPerDay: clamp(env.PUBLIC_FRESH_PER_IP_PER_DAY, 3, 1, 20),
    openFeedsPerDay: clamp(env.PUBLIC_OPEN_FEEDS_PER_DAY, 10, 0, 100),
    cacheHours: clamp(env.PUBLIC_CACHE_HOURS, 24, 1, 168),
    partialCacheHours: clamp(env.PUBLIC_PARTIAL_CACHE_HOURS, 1, 0, 24),
    jobMaxMs,
    externalVerifyMax: clamp(env.PUBLIC_EXTERNAL_VERIFY_MAX, 24, 1, 30),
    leaseMs: jobMaxMs + 60_000,
  };
}

export interface DayState {
  /** Qloo calls already spent (settled analyses + expired leases). */
  used: number;
  analyses: number;
  openFeeds: number;
  visitors: Record<string, number>;
  leases: Array<{ id: string; exp: number; calls: number }>;
}
const EMPTY_DAY: DayState = { used: 0, analyses: 0, openFeeds: 0, visitors: {}, leases: [] };

export interface Control {
  paused: boolean;
  at: string | null;
  note: string | null;
}

export type Refusal = 'paused' | 'budget' | 'busy' | 'visitor_limit' | 'open_limit';

export const dayKey = (now: number) => `day/${new Date(now).toISOString().slice(0, 10)}`;
export const visitorHash = (ip: string | null, now: number, salt = '') => createHash('sha256').update(`${salt}|${new Date(now).toISOString().slice(0, 10)}|${ip ?? 'unknown'}`).digest('hex').slice(0, 20);

/** Drops expired leases, counting their whole reservation as spent. */
function expire(s: DayState, now: number): DayState {
  const dead = s.leases.filter((l) => l.exp <= now);
  return dead.length ? { ...s, used: s.used + dead.reduce((a, l) => a + l.calls, 0), leases: s.leases.filter((l) => l.exp > now) } : s;
}

export const committed = (s: DayState) => s.used + s.leases.reduce((a, l) => a + l.calls, 0);

export class PublicGuard {
  constructor(
    private readonly store: CasStore,
    readonly cfg: PublicConfig,
    private readonly now: () => number = Date.now,
    private readonly salt = '',
  ) {}

  async control(): Promise<Control> {
    const c = await this.store.get('control');
    return { paused: false, at: null, note: null, ...((c?.data as Partial<Control>) ?? {}) };
  }

  async setPaused(paused: boolean, note: string | null): Promise<Control> {
    const c: Control = { paused, at: new Date(this.now()).toISOString(), note };
    await this.store.put('control', c);
    return c;
  }

  async usage() {
    const t = this.now();
    const s = expire(((await this.store.get(dayKey(t)))?.data as DayState | undefined) ?? EMPTY_DAY, t);
    return { day: dayKey(t).slice(4), used: s.used, inFlight: s.leases.length, reservedInFlight: committed(s) - s.used, committed: committed(s), remaining: Math.max(0, this.cfg.dailyCalls - committed(s)), analyses: s.analyses, openFeeds: s.openFeeds, visitors: Object.keys(s.visitors).length, limits: this.cfg };
  }

  /** Reserves one fresh analysis. Atomic across instances; never over-commits the daily budget. */
  async reserve(kind: 'catalog' | 'open', ip: string | null): Promise<{ ok: true; leaseId: string } | { ok: false; reason: Refusal }> {
    if ((await this.control()).paused) return { ok: false, reason: 'paused' };
    const t = this.now();
    const v = visitorHash(ip, t, this.salt);
    const leaseId = createHash('sha256').update(`${t}|${Math.random()}|${v}`).digest('hex').slice(0, 16);
    let reason: Refusal | null = null;
    await casUpdate<DayState>(this.store, dayKey(t), EMPTY_DAY, (cur) => {
      const s = expire(cur, t);
      reason =
        committed(s) + this.cfg.callsPerAnalysis > this.cfg.dailyCalls
          ? 'budget'
          : s.leases.length >= this.cfg.maxConcurrent
            ? 'busy'
            : (s.visitors[v] ?? 0) >= this.cfg.freshPerIpPerDay
              ? 'visitor_limit'
              : kind === 'open' && s.openFeeds >= this.cfg.openFeedsPerDay
                ? 'open_limit'
                : null;
      if (reason) return s === cur ? null : s; // still persist expirations
      return {
        ...s,
        analyses: s.analyses + 1,
        openFeeds: s.openFeeds + (kind === 'open' ? 1 : 0),
        visitors: { ...s.visitors, [v]: (s.visitors[v] ?? 0) + 1 },
        leases: [...s.leases, { id: leaseId, exp: t + this.cfg.leaseMs, calls: this.cfg.callsPerAnalysis }],
      };
    });
    return reason ? { ok: false, reason } : { ok: true, leaseId };
  }

  /** Releases the lease and records the real number of Qloo network calls (never more than reserved). */
  async settle(leaseId: string, actualCalls: number): Promise<void> {
    const t = this.now();
    await casUpdate<DayState>(this.store, dayKey(t), EMPTY_DAY, (cur) => {
      const lease = cur.leases.find((l) => l.id === leaseId);
      if (!lease) return null; // expired already: counted in full
      return { ...cur, used: cur.used + Math.min(Math.max(0, actualCalls), lease.calls), leases: cur.leases.filter((l) => l.id !== leaseId) };
    });
  }

  async cached<T>(cacheKey: string): Promise<{ at: string; body: T; fresh: boolean } | null> {
    const hit = (await this.store.get(`result/${cacheKey}`))?.data as { at: string; body: T; ttlHours?: number } | undefined;
    if (!hit) return null;
    return { at: hit.at, body: hit.body, fresh: this.now() - Date.parse(hit.at) < (hit.ttlHours ?? this.cfg.cacheHours) * 3600_000 };
  }

  async saveResult(cacheKey: string, body: unknown, ttlHours = this.cfg.cacheHours): Promise<string> {
    const at = new Date(this.now()).toISOString();
    await this.store.put(`result/${cacheKey}`, { at, body, ttlHours });
    return at;
  }
}

export const cacheKeyFor = (kind: 'show' | 'feed', id: string) => `${kind}-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
