// Follow-ups from the LIVE validation of 2026-10-23 (PR #2).
import { describe, expect, it } from 'vitest';
import { LiveQlooAdapter } from '../core/qloo/client';
import { runAgent } from '../core/agent/agent';
import { DATASETS, ORIGIN_OF } from '../core/api';
import { backgroundLimits } from '../core/public-live/handler';
import { publicConfig, type PublicEnv } from '../core/public-live/guard';
import { PUBLIC_ENV_KEYS } from '../core/public-live/env';

describe('LIVE validation follow-ups', () => {
  it('(a) background analyses wait up to 25 s per Qloo call (CREATIVO /v2/insights took > 10 s)', () => {
    expect(backgroundLimits(publicConfig({})).timeoutMs).toBe(25_000);
  });

  it('(b) with Qloo unreachable and a 10-call cap, guest lookups stop at the budget (phase A: 27 budget cut-offs)', async () => {
    const down = async () => {
      throw new Error('getaddrinfo ENOTFOUND validation.invalid');
    };
    const qloo = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: down, limits: { maxCalls: 10, retries: 1, concurrency: 3 } });
    const target = DATASETS.find((d) => d.id === 'creativo')!;
    const r = await runAgent({ target, others: DATASETS.filter((d) => d.id !== target.id), qloo, originOf: ORIGIN_OF });
    expect(qloo.metrics.networkCalls).toBe(10);
    // Guest lookups never start beyond the budget: only the remaining (non-guest) steps can hit it.
    expect(r.signalDiagnostics.guests.searched).toBeLessThanOrEqual(10);
    expect(qloo.metrics.errors.budget ?? 0).toBeLessThanOrEqual(10); // was 27 before the fix (same scenario)
  });

  it('(c) every public-path variable is read by the functions (public-usage reports the real limits)', () => {
    const used: Array<keyof PublicEnv> = ['QLOO_PUBLIC_ENABLED', 'PUBLIC_DAILY_QLOO_CALLS', 'PUBLIC_CALLS_PER_ANALYSIS', 'PUBLIC_MAX_CONCURRENT', 'PUBLIC_FRESH_PER_IP_PER_DAY', 'PUBLIC_OPEN_FEEDS_PER_DAY', 'PUBLIC_CACHE_HOURS', 'PUBLIC_PARTIAL_CACHE_HOURS', 'PUBLIC_JOB_MAX_SECONDS', 'PUBLIC_EXTERNAL_VERIFY_MAX', 'PUBLIC_IP_SALT'];
    for (const k of used) expect(PUBLIC_ENV_KEYS).toContain(k);
  });
});
