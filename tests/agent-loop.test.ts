import { describe, expect, it } from 'vitest';
import { runAgent } from '../core/agent/agent';
import { DATASETS } from '../core/api';
import { nameKey } from '../core/names';
import { NoQlooAdapter } from '../core/qloo/mock';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';
import type { PodcastDataset } from '../core/types';

const byId = (id: string) => DATASETS.find((d) => d.id === id)!;
const others = (id: string) => DATASETS.filter((d) => d.id !== id);
const titles = new Map<string, string[]>();
for (const d of DATASETS) for (const e of d.episodes) for (const g of e.guests) titles.set(nameKey(g.name), [...(titles.get(nameKey(g.name)) ?? []), e.title]);

/** Configurable LIVE test double: which strategies succeed is decided per test. */
class ScriptedQloo implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  readonly asked: string[] = [];
  constructor(private readonly opts: { guestContext?: boolean; podcast?: string | null; tags?: string[] }) {}
  async searchPerson(name: string): Promise<QlooEntity[]> {
    this.asked.push('person');
    return [{ entityId: `p:${nameKey(name)}`, name, description: this.opts.guestContext ? titles.get(nameKey(name))?.join(' ') : undefined }];
  }
  async searchPodcast(name: string): Promise<QlooEntity[]> {
    this.asked.push('podcast');
    return this.opts.podcast ? [{ entityId: 'pod:1', name: this.opts.podcast }] : [{ entityId: 'pod:x', name: `${name} Clips` }];
  }
  async findTags(q: string): Promise<QlooEntity[]> {
    this.asked.push('tags');
    return (this.opts.tags ?? []).includes(q) ? [{ entityId: `urn:tag:${q}`, name: q }] : [];
  }
  async personInsights(args: { signalIds: string[]; tagIds?: string[] }): Promise<QlooEntity[]> {
    this.asked.push(`insights:${args.signalIds.length}:${args.tagIds?.length ?? 0}`);
    return [{ entityId: 'q:new', name: 'Someone Brand New', popularity: 0.3 }];
  }
  async affinityFor({ candidateIds }: { candidateIds: string[] }) {
    return new Map(candidateIds.map((id, i) => [id, i]));
  }
  async categoryInsights(): Promise<QlooEntity[]> {
    return [];
  }
}

const tools = (r: Awaited<ReturnType<typeof runAgent>>) => r.plan.map((p) => p.tool);

describe('agent loop: observe → decide → act → verify → replan', () => {
  it('good coverage: uses guests as the signal and does not try fallbacks', async () => {
    const q = new ScriptedQloo({ guestContext: true });
    const r = await runAgent({ target: byId('lex-fridman'), others: others('lex-fridman'), qloo: q });
    expect(r.signalStrategy).toBe('guests');
    // No signal fallback before the audience signal is settled (the discovery may still replan later).
    const order = tools(r);
    expect(order.slice(0, order.indexOf('settle_signals'))).not.toContain('qloo_find_podcast');
    expect(r.discoveries.map((d) => d.name)).toEqual(['Someone Brand New']);
    for (const s of r.trace) expect(s.why && s.es.why).toBeTruthy();
  });

  it('replans when guest identities cannot be confirmed: podcast entity, then theme tags', async () => {
    const q = new ScriptedQloo({ guestContext: false, podcast: 'Lex Fridman Podcast', tags: ['ai', 'robots', 'physics', 'history', 'war'] });
    const r = await runAgent({ target: byId('lex-fridman'), others: others('lex-fridman'), qloo: q });
    const order = tools(r);
    expect(order.indexOf('qloo_resolve_guests')).toBeLessThan(order.indexOf('qloo_find_podcast'));
    expect(order.indexOf('qloo_find_podcast')).toBeLessThan(order.indexOf('qloo_find_theme_tags'));
    expect(r.plan.find((p) => p.tool === 'qloo_find_podcast')!.why).toMatch(/Replanning/);
    expect(['podcast', 'podcast+tags']).toContain(r.signalStrategy);
    expect(r.warnings.some((w) => /partial/.test(w))).toBe(true);
    expect(q.asked.some((a) => a.startsWith('insights:1'))).toBe(true);
  });

  it('gives up honestly when no strategy works', async () => {
    const r = await runAgent({ target: byId('lex-fridman'), others: others('lex-fridman'), qloo: new ScriptedQloo({ guestContext: false, podcast: null, tags: [] }) });
    expect(r.signalStrategy).toBe('none');
    expect(tools(r)).toEqual(expect.arrayContaining(['qloo_resolve_guests', 'qloo_find_podcast', 'qloo_find_theme_tags', 'settle_signals']));
    expect(tools(r)).not.toContain('qloo_discover_people');
    expect(r.discoveries).toEqual([]);
    expect(r.recommendations.length).toBe(5);
  });

  it('low guest coverage: skips guest lookups and starts from the show entity', async () => {
    const q = new ScriptedQloo({ guestContext: true, podcast: 'Santiago Bilinkis – Futuro en Construcción' });
    const r = await runAgent({ target: byId('santiago-bilinkis'), others: others('santiago-bilinkis'), qloo: q });
    expect(tools(r)).not.toContain('qloo_resolve_guests');
    expect(r.plan.find((p) => p.tool === 'qloo_find_podcast')!.why).toMatch(/guests cannot carry the audience signal/);
  });

  it('time budget: skips Qloo tools but still returns verified recommendations', async () => {
    const r = await runAgent({ target: byId('diary-of-a-ceo'), others: others('diary-of-a-ceo'), qloo: new ScriptedQloo({ guestContext: true }), deadlineMs: -1 });
    expect(tools(r).some((t) => t.startsWith('qloo_'))).toBe(false);
    expect(r.recommendations.length).toBe(5);
    expect(r.warnings.some((w) => /Time budget/.test(w))).toBe(true);
  });

  it('verification rejects a pick whose name appears in the show’s titles and re-selects', async () => {
    const ep = (id: string, title: string, published: string, guests: string[], confidence: 'high' | 'low' = 'high') => ({ id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence })), excluded: false });
    const mk = (id: string, episodes: ReturnType<typeof ep>[]): PodcastDataset => ({ id, name: id, host: 'H ' + id, hostAliases: ['H ' + id], language: 'en', description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes });
    // Ann Lee is named in a target title the extractor did not parse as a guest.
    const target = mk('t', [ep('1', 'AI safety special, a conversation about Ann Lee and robots', '2024-01-01T00:00:00.000Z', []), ep('2', 'AI chips', '2024-01-05T00:00:00.000Z', ['Zed Past'])]);
    // Ann Lee is the strongest candidate (two recent interviews), so she is picked first.
    const other = mk('o', [
      ep('a', 'AI safety and robots', '2024-05-01T00:00:00.000Z', ['Ann Lee']),
      ep('a2', 'AI safety and robots, part two', '2024-05-02T00:00:00.000Z', ['Ann Lee']),
      ep('b', 'AI robots future', '2024-02-02T00:00:00.000Z', ['Bob Ray']),
    ]);
    const r = await runAgent({ target, others: [other], qloo: new NoQlooAdapter(), asOf: '2024-06-01T00:00:00.000Z', k: 1 });
    expect(tools(r).filter((t) => t === 'verify_shortlist').length).toBeGreaterThanOrEqual(2);
    expect(tools(r).filter((t) => t === 'select_shortlist').length).toBeGreaterThanOrEqual(2);
    expect(r.plan.find((p) => p.tool === 'select_shortlist' && /re-selecting/.test(p.why))).toBeTruthy();
    expect(r.recommendations.map((x) => x.name)).toEqual(['Bob Ray']);
    expect(r.trace.some((s) => /possible earlier appearance/.test(s.detail))).toBe(true);
  });

  it('never exceeds the step budget and records why each step ran', async () => {
    const r = await runAgent({ target: byId('creativo'), others: others('creativo'), qloo: new NoQlooAdapter() });
    expect(r.plan.length).toBeLessThanOrEqual(40);
    expect(r.plan.every((p) => p.why && p.whyEs)).toBe(true);
  });
});
