import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import catalog from '../data/catalog.json';
import sources from '../data/catalog/sources.json';
import { hasVerifiedOrigin, showsFromCountry, unclassifiedShows } from '../core/catalog';

const byId = (id: string) => catalog.shows.find((s) => s.id === id)!;

describe('country of origin', () => {
  it('every show has an origin record; verified ones cite a source with a quote', () => {
    for (const s of catalog.shows) {
      expect(['verified', 'unverified']).toContain(s.origin.status);
      if (s.origin.status === 'verified') {
        expect(s.origin.country).toMatch(/^(us|gb|mx|ar|es)$/);
        expect(['production', 'host']).toContain(s.origin.basis);
        expect(s.origin.evidence.length).toBeGreaterThan(0);
        for (const e of s.origin.evidence) {
          expect(e.url).toMatch(/^https:\/\//);
          expect(e.quote.length).toBeGreaterThan(5);
        }
      } else expect(s.origin.country).toBeNull();
    }
  });

  it('a chart position never decides the country', () => {
    // The Wild Project charts in Argentina but is Spanish; ROCA PROJECT charted in Argentina but its origin is unverified.
    expect(showsFromCountry(catalog.shows, 'ar').map((s) => s.id)).not.toContain('wild-project');
    expect(showsFromCountry(catalog.shows, 'es').map((s) => s.id)).toContain('wild-project');
    expect(byId('wild-project').charts.map((c) => c.country)).toContain('ar');
    expect(showsFromCountry(catalog.shows, 'ar').map((s) => s.id)).not.toContain('roca-project');
    expect(unclassifiedShows(catalog.shows).map((s) => s.id)).toContain('roca-project');
    // Shows added for their verified origin need not be in any chart.
    expect(byId('metodo-rebord').charts).toEqual([]);
    expect(hasVerifiedOrigin(byId('metodo-rebord'), 'ar')).toBe(true);
  });

  it('the per-country lists and the unverified list partition the catalog', () => {
    const listed = ['us', 'gb', 'mx', 'ar', 'es'].flatMap((c) => showsFromCountry(catalog.shows, c).map((s) => s.id));
    const unverified = unclassifiedShows(catalog.shows).map((s) => s.id);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed, ...unverified].sort()).toEqual(catalog.shows.map((s) => s.id).sort());
    for (const c of ['us', 'gb', 'mx', 'ar', 'es']) expect(showsFromCountry(catalog.shows, c).length).toBeGreaterThan(0);
  });

  it('catalog.json carries the same origin as the curated sources', () => {
    // Spotify shows join the catalog once their episodes have been read (scripts/fetch-spotify.ts).
    const listed = sources.shows.filter((s: { id: string; spotifyId?: string }) => !s.spotifyId || existsSync(`data/podcasts/${s.id}.json`));
    for (const s of listed) expect(byId(s.id).origin).toEqual(s.origin);
    expect(catalog.originRule).toMatch(/never prove origin/);
  });
});
