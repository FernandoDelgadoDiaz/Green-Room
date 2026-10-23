import { describe, expect, it } from 'vitest';
import { runAgent } from '../core/agent/agent';
import { runBacktest } from '../core/backtest';
import { MockQlooAdapter, NoQlooAdapter } from '../core/qloo/mock';
import { nameKey } from '../core/names';
import { CORE_DATASETS as DATASETS } from '../core/api';
import type { PodcastDataset } from '../core/types';

const byId = (id: string) => DATASETS.find((d) => d.id === id)!;
const others = (id: string) => DATASETS.filter((d) => d.id !== id);

function ep(id: string, title: string, published: string, guests: string[]) {
  return { id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false };
}

const tiny = (id: string, language: string, episodes: ReturnType<typeof ep>[]): PodcastDataset => ({
  id,
  name: id,
  host: 'Host ' + id,
  hostAliases: ['Host ' + id],
  language,
  description: '',
  source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' },
  episodes,
});

describe('agent on real datasets', () => {
  it('never recommends someone who already appeared on the show', async () => {
    for (const d of DATASETS) {
      const r = await runAgent({ target: d, others: others(d.id), qloo: new MockQlooAdapter() });
      const past = new Set(d.episodes.flatMap((e) => e.guests.map((g) => nameKey(g.name))));
      expect(r.recommendations.length).toBe(5);
      for (const rec of r.recommendations) expect(past.has(rec.key)).toBe(false);
    }
  });

  it('every recommendation has verified evidence with a date and labeled components', async () => {
    const r = await runAgent({ target: byId('lex-fridman'), others: others('lex-fridman'), qloo: new MockQlooAdapter() });
    for (const rec of r.recommendations) {
      expect(rec.appearances.length).toBeGreaterThan(0);
      for (const a of rec.appearances) expect(a.published).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(rec.components.qlooAffinity.provenance).toBe('MOCK');
      expect(rec.components.qlooAffinity.weight).toBe(0);
    }
  });

  it('mock Qloo values never change the ranking', async () => {
    const t = byId('diary-of-a-ceo');
    const a = await runAgent({ target: t, others: others(t.id), qloo: new MockQlooAdapter() });
    const b = await runAgent({ target: t, others: others(t.id), qloo: new NoQlooAdapter() });
    expect(a.recommendations.map((r) => r.key)).toEqual(b.recommendations.map((r) => r.key));
  });

  it('prefers same-language candidates and warns when there are none', async () => {
    const lex = await runAgent({ target: byId('lex-fridman'), others: others('lex-fridman'), qloo: new NoQlooAdapter() });
    for (const rec of lex.recommendations) expect(rec.appearances.some((a) => a.showId !== 'creativo')).toBe(true);
    const creativo = await runAgent({ target: byId('creativo'), others: others('creativo'), qloo: new NoQlooAdapter() });
    expect(creativo.warnings.some((w) => w.includes('unknown language'))).toBe(true);
  });

  it('only uses information published before asOf', async () => {
    const asOf = '2024-01-01T00:00:00.000Z';
    const r = await runAgent({ target: byId('diary-of-a-ceo'), others: others('diary-of-a-ceo'), qloo: new NoQlooAdapter(), asOf });
    for (const rec of r.recommendations) for (const a of rec.appearances) expect(a.published < asOf).toBe(true);
  });
});

describe('agent decisions on controlled data', () => {
  it('relaxes the topical threshold when too few candidates fit, and logs it', async () => {
    const target = tiny('t', 'en', [ep('1', 'Quantum physics and the universe', '2024-01-01T00:00:00.000Z', ['Past Guest'])]);
    const other = tiny('o', 'en', [
      ep('a', 'Cooking pasta at home', '2024-02-01T00:00:00.000Z', ['Ann Lee']),
      ep('b', 'Gardening tips', '2024-02-02T00:00:00.000Z', ['Bob Ray']),
    ]);
    const r = await runAgent({ target, others: [other], qloo: new NoQlooAdapter(), asOf: '2024-06-01T00:00:00.000Z', k: 2 });
    expect(r.trace.some((s) => s.tool === 'relax_threshold')).toBe(true);
    expect(r.recommendations.map((x) => x.name).sort()).toEqual(['Ann Lee', 'Bob Ray']);
  });

  it('discards repeat guests with evidence', async () => {
    const target = tiny('t', 'en', [ep('1', 'AI and robots', '2024-01-01T00:00:00.000Z', ['Ann Lee'])]);
    const other = tiny('o', 'en', [ep('a', 'AI safety', '2024-02-01T00:00:00.000Z', ['Ann Lee']), ep('b', 'AI chips', '2024-02-02T00:00:00.000Z', ['Bob Ray'])]);
    const r = await runAgent({ target, others: [other], qloo: new NoQlooAdapter(), asOf: '2024-06-01T00:00:00.000Z', k: 1 });
    expect(r.recommendations.map((x) => x.name)).toEqual(['Bob Ray']);
    expect(r.discarded[0]).toMatchObject({ name: 'Ann Lee' });
    expect(r.discarded[0].evidence?.episodeId).toBe('1');
  });
});

describe('backtest', () => {
  it('passes the leakage audit and reports reachable ground truth', async () => {
    const r = await runBacktest({ target: byId('diary-of-a-ceo'), others: others('diary-of-a-ceo'), cutoff: '2025-01-01T00:00:00.000Z', qlooArm: { label: 'mock', adapter: new MockQlooAdapter() } });
    expect(r.leakage.ok).toBe(true);
    expect(r.reachable.length).toBeLessThanOrEqual(r.hidden.length);
    expect(r.arms.find((a) => a.qlooMode === 'MOCK')?.isEvidence).toBe(false);
    expect(r.arms[0].isEvidence).toBe(true);
    for (const h of r.arms[0].hits) expect(h.bookedOn >= r.cutoff).toBe(true);
  });

  it('counts only first-time guests after the cutoff', async () => {
    const target = tiny('t', 'en', [
      ep('1', 'AI talk', '2024-01-01T00:00:00.000Z', ['Ann Lee']),
      ep('2', 'AI talk again', '2024-08-01T00:00:00.000Z', ['Ann Lee']),
      ep('3', 'AI chips', '2024-09-01T00:00:00.000Z', ['Bob Ray']),
    ]);
    const other = tiny('o', 'en', [ep('a', 'AI chips explained', '2024-03-01T00:00:00.000Z', ['Bob Ray'])]);
    const r = await runBacktest({ target, others: [other], cutoff: '2024-06-01T00:00:00.000Z' });
    expect(r.hidden.map((h) => h.name)).toEqual(['Bob Ray']);
    expect(r.arms[0].hitsAt[5]).toBe(1);
  });
});
