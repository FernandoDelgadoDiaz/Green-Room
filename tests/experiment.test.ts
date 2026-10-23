import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveQlooAdapter } from '../core/qloo/client';
import { resolvePerson } from '../core/qloo/resolve';
import { assertQlooBaseUrl, loadQlooCredentials, parseHarnessConfig, redact } from '../core/qloo/credentials';
import { runComparison, signTest, summarizeComparison, summarizeCoverage, runCoverage } from '../core/experiment';
import { DATASETS } from '../core/api';
import { nameKey } from '../core/names';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';

const e = (id: string, name: string, extra: Partial<QlooEntity> = {}): QlooEntity => ({ entityId: id, name, ...extra });

describe('Qloo request parameters (official Entity Type Parameter Guide)', () => {
  it('scores candidates with filter.results.entities, never the non-existent filter.entities', async () => {
    const seen: string[] = [];
    const q = new LiveQlooAdapter({
      apiKey: 'k',
      fetchImpl: async (url) => {
        seen.push(url);
        return { status: 200, ok: true, json: async () => ({ results: { entities: [{ entity_id: 'c1', name: 'A', query: { affinity: 0.8 } }, { entity_id: 'c2', name: 'B' }] } }) };
      },
    });
    const m = await q.affinityFor({ signalIds: ['s1'], candidateIds: ['c1', 'c2'] });
    const u = new URL(seen[0]);
    expect(u.searchParams.get('filter.results.entities')).toBe('c1,c2');
    expect(u.searchParams.has('filter.entities')).toBe(false);
    expect([...m]).toEqual([['c1', 0.8]]);
    expect(q.calls[0].note).toMatch(/^affinity values: 1/);
  });

  it('asks /search for 5 results so namesakes are visible', async () => {
    const seen: string[] = [];
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: async (url) => (seen.push(url), { status: 200, ok: true, json: async () => ({ results: [] }) }) });
    await q.searchPerson('Michael Levin');
    expect(new URL(seen[0]).searchParams.get('take')).toBe('5');
  });
});

describe('person resolution', () => {
  it('accepts only a unique exact match', () => {
    expect(resolvePerson([e('1', 'Rick Rubin'), e('2', 'Rick Rubin Jr')], 'Rick Rubin')).toMatchObject({ status: 'exact', entity: { entityId: '1' } });
    expect(resolvePerson([e('1', 'Michael Levin'), e('2', 'Michael Levin')], 'Michael Levin').status).toBe('ambiguous');
    expect(resolvePerson([e('1', 'Michael Levin'), e('1', 'Michael Levin')], 'Michael Levin').status).toBe('exact');
    expect(resolvePerson([e('1', 'Mike Levin')], 'Michael Levin').status).toBe('fuzzy');
    expect(resolvePerson([], 'Nobody').status).toBe('none');
  });
});

describe('credentials', () => {
  it('reads the harness config in both formats', () => {
    expect(parseHarnessConfig('api_key=abc123\nbase_url=https://hackathon.api.qloo.com\n')).toEqual({ apiKey: 'abc123', baseUrl: 'https://hackathon.api.qloo.com' });
    expect(parseHarnessConfig('{"api_key":"xyz"}')).toEqual({ apiKey: 'xyz', baseUrl: undefined });
    expect(parseHarnessConfig('')).toEqual({});
  });

  it('only sends the key to https *.qloo.com hosts', () => {
    expect(assertQlooBaseUrl('https://hackathon.api.qloo.com/')).toBe('https://hackathon.api.qloo.com');
    for (const bad of ['http://hackathon.api.qloo.com', 'https://evil.example', 'https://qloo.com.evil.example', 'https://u:p@hackathon.api.qloo.com']) expect(() => assertQlooBaseUrl(bad)).toThrow();
  });

  it('prefers QLOO_API_KEY, then `qloo setup` config; ignores a production base_url', async () => {
    const home = mkdtempSync(join(tmpdir(), 'qloo-'));
    writeFileSync(join(home, 'config'), 'api_key=from-config\nbase_url=https://api.qloo.com\n');
    const fromConfig = await loadQlooCredentials({ env: { QLOO_HOME: home }, allowPrompt: false });
    expect(fromConfig).toEqual({ apiKey: 'from-config', baseUrl: 'https://hackathon.api.qloo.com', source: 'qloo-setup' });
    const fromEnv = await loadQlooCredentials({ env: { QLOO_HOME: home, QLOO_API_KEY: 'from-env' }, allowPrompt: false });
    expect(fromEnv.source).toBe('env');
    await expect(loadQlooCredentials({ env: { QLOO_HOME: mkdtempSync(join(tmpdir(), 'qloo-')) }, allowPrompt: false })).rejects.toThrow(/No Qloo key/);
  });

  it('redacts the key from any message', () => {
    expect(redact('failed with key sk_live_123 in header', 'sk_live_123')).toBe('failed with key [redacted] in header');
  });

  it('the experiment script never interpolates the key into output', () => {
    const src = readFileSync('scripts/qloo-experiment.ts', 'utf8');
    expect(src).not.toMatch(/\$\{creds\.apiKey\}/);
    // The only console.log is the `say` helper, and it redacts.
    expect(src.match(/console\.log\(/g)).toHaveLength(1);
    expect(src).toContain('console.log(redact(s, creds.apiKey))');
    expect(src).toMatch(/redact\(JSON\.stringify\(report/);
  });
});

const TITLES = new Map<string, string[]>();
for (const d of DATASETS) for (const ep of d.episodes) for (const g of ep.guests) TITLES.set(nameKey(g.name), [...(TITLES.get(nameKey(g.name)) ?? []), ep.title]);

// Test double with the LIVE mode flag, so the agent applies the real blend. It is never used outside tests.
class FakeLiveQloo implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  constructor(private readonly affinity: (key: string) => number | undefined) {}
  async searchPerson(name: string) {
    this.calls.push({ endpoint: '/search', params: { query: name }, status: 200, ms: 0, resultCount: 1 });
    // Context evidence: a description built from this person's real interview titles.
    return [e(`id:${nameKey(name)}`, name, { description: TITLES.get(nameKey(name))?.join(' ') ?? 'test person' })];
  }
  async personInsights() {
    return [];
  }
  async affinityFor({ signalIds, candidateIds }: { signalIds: string[]; candidateIds: string[] }) {
    const out = new Map<string, number>();
    for (const id of candidateIds) {
      const a = this.affinity(id.slice(3));
      if (a !== undefined) out.set(id, a);
    }
    this.calls.push({ endpoint: '/v2/insights', params: { 'signal.interests.entities': signalIds.join(','), 'filter.results.entities': candidateIds.join(',') }, status: 200, ms: 0, resultCount: out.size, note: `affinity values: ${out.size}` });
    return out;
  }
  async categoryInsights() {
    return [];
  }
}

describe('T5 comparison pipeline (offline, fake Qloo)', () => {
  const doac = DATASETS.filter((d) => d.id !== 'creativo');

  it('flags the comparison as uninformative when Qloo returns no affinity values', async () => {
    const cells = await runComparison(() => new FakeLiveQloo(() => undefined), doac.filter((d) => d.id === 'diary-of-a-ceo').concat(doac.filter((d) => d.id !== 'diary-of-a-ceo')).slice(0, 2), ['2025-01-01']);
    const s = summarizeComparison(cells.filter((c) => c.showId === 'diary-of-a-ceo'));
    expect(s.noAffinityData).toBe(true);
    // Neutral 0.5 for everyone keeps the same order: no fabricated change.
    expect(cells.find((c) => c.showId === 'diary-of-a-ceo')!.top10Overlap).toBe(10);
  });

  it('can detect a change when affinities carry information (oracle affinity = later booking)', async () => {
    const target = DATASETS.find((d) => d.id === 'diary-of-a-ceo')!;
    const later = new Set(target.episodes.filter((x) => x.published >= '2025-01-01').flatMap((x) => x.guests.map((g) => nameKey(g.name))));
    const cells = await runComparison(() => new FakeLiveQloo((k) => (later.has(k) ? 0.99 : 0.1)), [target, ...DATASETS.filter((d) => d.id !== target.id)].slice(0, 2), ['2025-01-01']);
    const c = cells.find((x) => x.showId === 'diary-of-a-ceo')!;
    expect(c.withQloo[10]).toBeGreaterThanOrEqual(c.without[10]);
    expect(c.affinityReceived).toBeGreaterThan(0);
    expect(c.leakageAuditOk).toBe(true);
  });

  it('sign test is exact and two-sided', () => {
    expect(signTest(0, 0)).toBe(1);
    expect(signTest(5, 0)).toBeCloseTo(0.0625, 6);
    expect(signTest(3, 3)).toBe(1);
  });
});

describe('T2 coverage (offline, fake Qloo)', () => {
  it('counts every sampled person once per show and classifies namesakes as ambiguous', async () => {
    const lex = DATASETS.find((d) => d.id === 'lex-fridman')!;
    const fake = new FakeLiveQloo(() => undefined);
    fake.searchPerson = async (name: string) => (name.length % 2 ? [e('a', name), e('b', name)] : [e('a', name)]);
    const rows = await runCoverage(fake, [lex, DATASETS.find((d) => d.id === 'diary-of-a-ceo')!], ['2025-01-01']);
    const s = summarizeCoverage(rows);
    expect(s.overall.total).toBeGreaterThan(50);
    expect(s.overall.ambiguous).toBeGreaterThan(0);
    expect(s.overall.exact_unconfirmed).toBeGreaterThan(0);
    expect(s.overall.ambiguous + s.overall.exact_unconfirmed).toBe(s.overall.total);
  });
});
