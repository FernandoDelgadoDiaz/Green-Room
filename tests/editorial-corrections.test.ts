import { describe, expect, it } from 'vitest';
import { checkIdentity } from '../core/qloo/resolve';
import { runAgent } from '../core/agent/agent';
import { CORE_DATASETS as DATASETS } from '../core/api';
import { nameKey } from '../core/names';
import { NoQlooAdapter } from '../core/qloo/mock';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';

const byId = (id: string) => DATASETS.find((d) => d.id === id)!;
const others = (id: string) => DATASETS.filter((d) => d.id !== id);

describe('identity needs context, not just a name', () => {
  const titles = ['#486 – Michael Levin: Hidden Reality of Alien Intelligence & Biological Life'];
  it('rejects a unique exact name with no context', () => {
    expect(checkIdentity([{ entityId: '1', name: 'Michael Levin' }], 'Michael Levin', titles)).toEqual({ status: 'pending', reason: 'no_context' });
    expect(checkIdentity([{ entityId: '1', name: 'Michael Levin', description: 'American philosopher of ethics' }], 'Michael Levin', titles)).toMatchObject({ status: 'pending' });
  });
  it('rejects namesakes and fuzzy names', () => {
    expect(checkIdentity([{ entityId: '1', name: 'Michael Levin' }, { entityId: '2', name: 'Michael Levin' }], 'Michael Levin', titles)).toEqual({ status: 'pending', reason: 'ambiguous' });
    expect(checkIdentity([{ entityId: '1', name: 'Mike Levin' }], 'Michael Levin', titles)).toEqual({ status: 'pending', reason: 'fuzzy' });
  });
  it('confirms with shared context', () => {
    const r = checkIdentity([{ entityId: '1', name: 'Michael Levin', description: 'Biologist researching bioelectricity and biological intelligence' }], 'Michael Levin', titles);
    expect(r).toMatchObject({ status: 'confirmed' });
  });
});

/** Fake LIVE Qloo whose search results carry NO description: every identity stays unconfirmed. */
class NameOnlyQloo implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  personInsightsCalled = false;
  async searchPerson(name: string): Promise<QlooEntity[]> {
    return [{ entityId: `id:${nameKey(name)}`, name }];
  }
  async personInsights(): Promise<QlooEntity[]> {
    this.personInsightsCalled = true;
    return [];
  }
  async affinityFor() {
    return new Map<string, number>();
  }
  async searchPodcast(): Promise<QlooEntity[]> {
    return [];
  }
  async findTags(): Promise<QlooEntity[]> {
    return [];
  }
  async categoryInsights() {
    return [];
  }
}

/** Fake LIVE Qloo with context and a few people it "discovers". */
class DiscoveringQloo extends NameOnlyQloo {
  constructor(private readonly titles: Map<string, string[]>) {
    super();
  }
  override async searchPerson(name: string) {
    return [{ entityId: `id:${nameKey(name)}`, name, description: this.titles.get(nameKey(name))?.join(' ') }];
  }
  override async personInsights(): Promise<QlooEntity[]> {
    return [{ entityId: 'q:new1', name: 'Totally New Person', popularity: 0.4 }, { entityId: 'q:new2', name: 'Another Unknown', popularity: 0.9 }];
  }
}

describe('agent: identity, language and history claims', () => {
  it('does not use Qloo signals built on name-only matches', async () => {
    const q = new NameOnlyQloo();
    const r = await runAgent({ target: byId('lex-fridman'), others: others('lex-fridman'), qloo: q });
    expect(q.personInsightsCalled).toBe(false);
    expect(r.trace.some((t) => /Too few confirmed identities/.test(t.decision ?? ''))).toBe(true);
  });

  it('keeps Qloo discoveries apart, pending verification, with unknown language', async () => {
    const titles = new Map<string, string[]>();
    for (const d of DATASETS) for (const e of d.episodes) for (const g of e.guests) titles.set(nameKey(g.name), [...(titles.get(nameKey(g.name)) ?? []), e.title]);
    const r = await runAgent({ target: byId('creativo'), others: others('creativo'), qloo: new DiscoveringQloo(titles) });
    expect(r.discoveries.map((d) => d.name)).toEqual(['Totally New Person', 'Another Unknown']);
    for (const d of r.discoveries) {
      expect(d.identity).toMatchObject({ status: 'pending', reason: 'qloo_only' });
      expect(d.language.status).toBe('unknown');
    }
    expect(r.recommendations.some((x) => x.name === 'Totally New Person')).toBe(false);
  });

  it('never claims "never a guest" when the feed history is incomplete', async () => {
    const r = await runAgent({ target: byId('diary-of-a-ceo'), others: others('diary-of-a-ceo'), qloo: new NoQlooAdapter() });
    expect(r.guestCoverage).toBeLessThan(1);
    for (const rec of r.recommendations) {
      expect(rec.history.status).toBe('not_found_partial');
      expect(rec.history.episodesWithoutGuestName).toBeGreaterThan(0);
      const t = rec.rationale.map((x) => x.textEs).join(' ');
      expect(t).toMatch(/no se puede descartar una participación anterior/);
      expect(t).not.toMatch(/nunca/i);
    }
  });

  it('language: confirmed only with a verified same-language interview; otherwise unknown, not discarded', async () => {
    const r = await runAgent({ target: byId('creativo'), others: others('creativo'), qloo: new NoQlooAdapter() });
    for (const rec of r.recommendations) {
      if (rec.language.status === 'confirmed') expect(rec.appearances.some((a) => a.showId === 'creativo' || DATASETS.find((d) => d.id === a.showId)!.language === 'es')).toBe(true);
      else expect(rec.language.status).toBe('unknown');
    }
    // Cross-language candidates stay in the full ranking.
    expect(r.ranked.length).toBeGreaterThan(r.recommendations.length);
  });
});
