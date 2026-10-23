// Access control for LIVE Qloo calls (server-side only).
//
// LIVE needs all of the following; anything missing means MOCK, and the reason is reported:
//   1. QLOO_LIVE_ENABLED is exactly "true" (default false);
//   2. QLOO_API_KEY is set (Netlify env var, Functions scope);
//   3. the request carries "Authorization: Bearer <private test token>" and SHA-256(token) is in
//      LIVE_ACCESS_TOKEN_SHA256. Only the hash is stored server-side, and no token ships in the frontend;
//   4. the token is under its hourly quota (per function instance; the per-IP limit is set in the
//      Netlify function config).

import { createHash, timingSafeEqual } from 'node:crypto';
import type { QlooLimits } from './qloo/client';

export interface LiveEnv {
  QLOO_LIVE_ENABLED?: string;
  QLOO_API_KEY?: string;
  QLOO_BASE_URL?: string;
  LIVE_ACCESS_TOKEN_SHA256?: string;
  LIVE_MAX_ANALYSES_PER_HOUR?: string;
  QLOO_MAX_CALLS_PER_ANALYSIS?: string;
  QLOO_MAX_CALLS_PER_DIAGNOSTIC?: string;
  QLOO_CONCURRENCY?: string;
  QLOO_TIMEOUT_MS?: string;
  QLOO_DEADLINE_MS?: string;
}

export const MIN_TOKEN_LENGTH = 32;

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function liveSwitch(env: LiveEnv): { on: boolean; reason?: string } {
  if (env.QLOO_LIVE_ENABLED !== 'true') return { on: false, reason: 'QLOO_LIVE_ENABLED is not "true"' };
  if (!env.QLOO_API_KEY) return { on: false, reason: 'QLOO_API_KEY is not set' };
  if (!allowedHashes(env).length) return { on: false, reason: 'LIVE_ACCESS_TOKEN_SHA256 is not set' };
  return { on: true };
}

function allowedHashes(env: LiveEnv): Buffer[] {
  return (env.LIVE_ACCESS_TOKEN_SHA256 ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[0-9a-f]{64}$/.test(h))
    .map((h) => Buffer.from(h, 'hex'));
}

/** Returns the token's hash (used as the quota key) when the bearer token is valid, else null. */
export function verifyBearer(authorization: string | undefined | null, env: LiveEnv): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  if (!m || m[1].length < MIN_TOKEN_LENGTH) return null;
  const digest = createHash('sha256').update(m[1], 'utf8').digest();
  let ok = false;
  for (const h of allowedHashes(env)) if (timingSafeEqual(digest, h)) ok = true; // no early exit
  return ok ? digest.toString('hex') : null;
}

const clamp = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

/** Limits per analysis. The deadline stays well under Netlify's 60 s synchronous limit. */
export function limitsFromEnv(env: LiveEnv, kind: 'analysis' | 'diagnostic' = 'analysis'): QlooLimits {
  return {
    maxCalls: kind === 'analysis' ? clamp(env.QLOO_MAX_CALLS_PER_ANALYSIS, 80, 1, 200) : clamp(env.QLOO_MAX_CALLS_PER_DIAGNOSTIC, 150, 1, 300),
    concurrency: clamp(env.QLOO_CONCURRENCY, 6, 1, 10),
    timeoutMs: clamp(env.QLOO_TIMEOUT_MS, 8000, 1000, 15000),
    deadlineMs: clamp(env.QLOO_DEADLINE_MS, 45000, 5000, 50000),
    retries: 1,
  };
}

/** Sliding one-hour window per token, in memory (per warm instance: a soft guard, not a hard quota). */
export class HourlyQuota {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}
  take(key: string, max: number): { ok: boolean; remaining: number; retryAfterS: number } {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < 3600_000);
    if (list.length >= max) {
      this.hits.set(key, list);
      return { ok: false, remaining: 0, retryAfterS: Math.ceil((3600_000 - (t - list[0])) / 1000) };
    }
    list.push(t);
    this.hits.set(key, list);
    return { ok: true, remaining: max - list.length, retryAfterS: 0 };
  }
}
