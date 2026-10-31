// Past guests outside the analysis window (older feed items, the public record) are never proposed.
import { describe, expect, it } from 'vitest';
import { runAgent } from '../core/agent/agent';
import { knownPastEpisodes } from '../core/known-past-guests';
import { NoQlooAdapter } from '../core/qloo/mock';
import type { PodcastDataset } from '../core/types';

const ep = (id: string, title: string, published: string, guests: string[]) => ({ id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false });
const mk = (id: string, episodes: ReturnType<typeof ep>[], olderEpisodes?: ReturnType<typeof ep>[]): PodcastDataset => ({ id, name: id, host: `Host ${id}`, hostAliases: [`Host ${id}`], language: 'en', description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes, ...(olderEpisodes ? { olderEpisodes } : {}) });

const target = mk(
  'show',
  [ep('1', 'Zed Past: building a startup and raising money', '2026-01-01T00:00:00Z', ['Zed Past']), ep('2', 'Yan Past: venture capital and startups', '2026-02-01T00:00:00Z', ['Yan Past'])],
  [ep('old1', 'Ann Lee: startups, money and venture capital', '2019-03-01T00:00:00Z', ['Ann Lee'])],
);
const other = mk('other', [
  ep('o1', 'Ann Lee: building a startup and raising venture money', '2026-05-01T00:00:00Z', ['Ann Lee']),
  ep('o2', 'Bob Ray: startups and venture capital', '2026-04-01T00:00:00Z', ['Bob Ray']),
]);

describe('past guests beyond the analysis window', () => {
  it('excludes someone who was on the show in an older feed item, citing it', async () => {
    const r = await runAgent({ target, others: [other], qloo: new NoQlooAdapter(), k: 3, asOf: '2026-10-01T00:00:00.000Z' });
    expect(r.recommendations.map((x) => x.name)).not.toContain('Ann Lee');
    expect(r.recommendations.map((x) => x.name)).toContain('Bob Ray');
    expect(r.discarded.find((d) => d.name === 'Ann Lee')?.reasonEs).toMatch(/Ya fue invitado en show \(2019-03-01\)/);
  });

  it('reads the public record for appearances the feed does not carry, each with its source', () => {
    const twist = knownPastEpisodes('this-week-in-startups');
    expect(twist.map((e) => e.guests[0].name).sort()).toEqual(['Ben Horowitz', 'Marc Andreessen', 'Travis Kalanick']);
    for (const e of twist) expect(e.url).toMatch(/^https:\/\//);
    expect(knownPastEpisodes('no-such-show')).toEqual([]);
  });
});
