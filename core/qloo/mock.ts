// MOCK adapter used until the hackathon key arrives. Rules:
//   - It never invents people, artists or titles: insights calls return empty lists.
//   - It only "resolves" names the caller already has, to ids prefixed MOCK:, and returns
//     deterministic pseudo-affinities so the pipeline and UI can be exercised end to end.
//   - Every value it produces is labeled MOCK downstream and is excluded from any evidence claim.

import { nameKey } from '../names';
import type { QlooAdapter, QlooCall, QlooEntity } from './types';

/** FNV-1a: stable across runs and platforms, so tests and screenshots are reproducible. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class MockQlooAdapter implements QlooAdapter {
  readonly mode = 'MOCK' as const;
  readonly calls: QlooCall[] = [];

  private log(endpoint: string, params: Record<string, string>, resultCount: number, note: string) {
    this.calls.push({ endpoint, params, status: 'mock', ms: 0, resultCount, note });
  }

  async searchPerson(name: string): Promise<QlooEntity[]> {
    const id = `MOCK:person:${nameKey(name).replace(/\s+/g, '-')}`;
    this.log('/search', { query: name, types: 'urn:entity:person' }, 1, 'MOCK: echoes the queried name; real coverage unknown');
    return [{ entityId: id, name, type: 'urn:entity:person' }];
  }

  async searchPodcast(name: string): Promise<QlooEntity[]> {
    this.log('/search', { query: name, types: 'urn:entity:podcast' }, 0, 'MOCK: podcast coverage unknown without the API; returns nothing');
    return [];
  }

  async findTags(query: string): Promise<QlooEntity[]> {
    this.log('/v2/tags', { 'filter.query': query }, 0, 'MOCK: no tag ontology without the API; returns nothing');
    return [];
  }

  async personInsights(args: { signalIds: string[]; excludeIds: string[]; take: number }): Promise<QlooEntity[]> {
    this.log('/v2/insights', { 'filter.type': 'urn:entity:person', signals: String(args.signalIds.length) }, 0, 'MOCK: returns no people (we never invent candidates)');
    return [];
  }

  async affinityFor({ signalIds, candidateIds }: { signalIds: string[]; candidateIds: string[] }): Promise<Map<string, number>> {
    const seed = signalIds.slice().sort().join('|');
    const out = new Map<string, number>();
    for (const id of candidateIds) out.set(id, 0.2 + (stableHash(`${seed}#${id}`) % 700) / 1000);
    this.log('/v2/insights', { 'filter.type': 'urn:entity:person', 'filter.results.entities': String(candidateIds.length) }, out.size, 'MOCK: pseudo-random affinities, not data');
    return out;
  }

  async categoryInsights(args: { type: string }): Promise<QlooEntity[]> {
    this.log('/v2/insights', { 'filter.type': args.type }, 0, 'MOCK: no cross-domain taste data without the API');
    return [];
  }
}

/** Adapter for the "without Qloo" arm: every call is a no-op. */
export class NoQlooAdapter implements QlooAdapter {
  readonly mode = 'OFF' as const;
  readonly calls: QlooCall[] = [];
  async searchPerson() {
    return [];
  }
  async searchPodcast() {
    return [];
  }
  async findTags() {
    return [];
  }
  async personInsights() {
    return [];
  }
  async affinityFor() {
    return new Map<string, number>();
  }
  async categoryInsights() {
    return [];
  }
}
