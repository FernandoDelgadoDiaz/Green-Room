import { describe, expect, it } from 'vitest';
import { buildEditorialSet, parseCsv, ratingsFromCsv, scoreEditorial, sheetCsv, LIST_SIZE, type EditorialKey } from '../core/editorial';
import { CORE_DATASETS as DATASETS } from '../core/api';
import { nameKey } from '../core/names';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';

const titles = new Map<string, string[]>();
for (const d of DATASETS) for (const e of d.episodes) for (const g of e.guests) titles.set(nameKey(g.name), [...(titles.get(nameKey(g.name)) ?? []), e.title]);

class FakeLive implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  async searchPerson(name: string): Promise<QlooEntity[]> {
    return [{ entityId: `id:${nameKey(name)}`, name, description: titles.get(nameKey(name))?.join(' ') }];
  }
  async personInsights(): Promise<QlooEntity[]> {
    return [1, 2, 3, 4, 5, 6].map((i) => ({ entityId: `q:${i}`, name: `Discovered Person ${i}` }));
  }
  async affinityFor({ candidateIds }: { candidateIds: string[] }) {
    return new Map(candidateIds.map((id, i) => [id, 1 - i / candidateIds.length]));
  }
  async searchPodcast(): Promise<QlooEntity[]> {
    return [];
  }
  async findTags(): Promise<QlooEntity[]> {
    return [];
  }
  async categoryInsights(): Promise<QlooEntity[]> {
    return [];
  }
}

describe('blind editorial evaluation', async () => {
  const { items, lists } = await buildEditorialSet(DATASETS, () => new FakeLive(), ['lex-fridman']);
  const sheet = sheetCsv(items);

  it('builds two comparable lists of the same size, with at most 5 discoveries in B', () => {
    const l = lists['lex-fridman'];
    expect(l.A).toHaveLength(LIST_SIZE);
    expect(l.B).toHaveLength(LIST_SIZE);
    expect(l.bDiscoveries).toBe(5);
  });

  it('the rater sheet reveals no system, score or Qloo value', () => {
    expect(sheet).not.toMatch(/qloo|mock|live|score|affinity|list a|list b|sistema/i);
    const [head] = parseCsv(sheet);
    expect(head).toEqual(expect.arrayContaining(['item_id', 'relevance_1_5', 'originality_1_5', 'identity_ok_doubtful_wrong_unknown', 'language_yes_probable_no_unknown']));
    // Pooled: each person appears once even if both systems proposed them.
    expect(new Set(items.map((i) => i.name)).size).toBe(items.length);
  });

  it('scores per system with exclusive items separated, never using the backtest', () => {
    const rows = parseCsv(sheet);
    const filled = [rows[0], ...rows.slice(1).map((r) => [r[0], r[1], r[2], r[3], '4', r[2].startsWith('Discovered') ? '5' : '2', 'ok', 'yes', 'yes', ''])];
    const ratings = ratingsFromCsv(filled.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n'), 'r1');
    const key: EditorialKey = { createdAt: '', design: '', sheetSha256: '', lists };
    const s = scoreEditorial(key, ratings);
    expect(s.overall.onlyB.originality).toBe(5);
    expect(s.overall.onlyA.originality).toBe(2);
    expect(JSON.stringify({ overall: s.overall, byShow: s.byShow })).not.toMatch(/hits|backtest/i);
    expect(s.notes.join(' ')).toMatch(/No backtest result is used/);
  });
});
