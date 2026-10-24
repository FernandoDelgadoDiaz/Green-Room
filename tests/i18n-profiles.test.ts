import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleApi, CORE_DATASETS as DATASETS } from '../core/api';
import { runAgent } from '../core/agent/agent';
import { runBacktest } from '../core/backtest';
import { MockQlooAdapter, NoQlooAdapter } from '../core/qloo/mock';
import { draftProposal } from '../core/pitch';
import { contextOverlap, resolveProfiles, type GuestProfile } from '../core/profiles';
import baseline from './fixtures/ranking-baseline.json';

const others = (id: string) => DATASETS.filter((d) => d.id !== id);
const byId = (id: string) => DATASETS.find((d) => d.id === id)!;

describe('presentation changes do not alter the logic', () => {
  // Fixed corpus (the original three shows): the catalog adds comparison shows, which legitimately
  // changes rankings, so the regression is checked on the corpus the baseline was recorded with.
  it('recommendations keep the same people, order and scores (±0.001; "now" moves)', async () => {
    for (const [showId, expected] of Object.entries(baseline.recs)) {
      const r = await runAgent({ target: byId(showId), others: others(showId), qloo: new MockQlooAdapter() });
      expect(r.recommendations.map((x) => x.key)).toEqual((expected as Array<[string, number]>).map(([k]) => k));
      r.recommendations.forEach((x, i) => expect(Math.abs(x.score - (expected as Array<[string, number]>)[i][1])).toBeLessThan(1e-3));
    }
  });

  it('backtest results are identical to the recorded baseline', async () => {
    for (const [id, expected] of Object.entries(baseline.backtests)) {
      const [showId, cutoff] = id.split('@');
      const r = await runBacktest({
        target: byId(showId),
        others: others(showId),
        cutoff: new Date(cutoff).toISOString(),
        qlooArm: { label: 'x', labelEs: 'x', adapter: new MockQlooAdapter() },
      });
      expect(r.arms.map((a) => [a.qlooMode, a.hitsAt, a.hits.map((h) => [h.name, h.rank])])).toEqual(expected);
    }
  });
});

describe('Spanish and English texts', () => {
  it('every agent step, reason and warning exists in both languages', async () => {
    for (const d of DATASETS) {
      const r = await runAgent({ target: d, others: others(d.id), qloo: new MockQlooAdapter() });
      for (const s of r.trace) {
        expect(s.title && s.es.title).toBeTruthy();
        expect(s.detail && s.es.detail).toBeTruthy();
        expect(Boolean(s.decision)).toBe(Boolean(s.es.decision));
        expect(s.es.title).not.toBe(s.title);
      }
      for (const rec of r.recommendations) for (const x of rec.rationale) expect(x.textEs).toBeTruthy();
      expect(r.warningsEs.length).toBe(r.warnings.length);
      for (const t of r.themes) expect(t.labelEs).toBeTruthy();
      for (const x of r.discarded) expect(x.reasonEs).toBeTruthy();
    }
  });

  it('backtest arms and limitations are bilingual', async () => {
    const r = await runBacktest({ target: byId('diary-of-a-ceo'), others: others('diary-of-a-ceo'), cutoff: '2025-01-01T00:00:00.000Z', qlooArm: { label: 'x', labelEs: 'y', adapter: new MockQlooAdapter() } });
    expect(r.limitationsEs.length).toBe(r.limitations.length);
    for (const a of r.arms) expect(a.labelEs).toBeTruthy();
  });

  it('proposals are written in the requested language, citing the same interview in both', async () => {
    const r = await runAgent({ target: byId('diary-of-a-ceo'), others: others('diary-of-a-ceo'), qloo: new NoQlooAdapter() });
    const rec = r.recommendations[0];
    const show = { name: 'The Diary Of A CEO', host: 'Steven Bartlett' };
    const es = draftProposal(rec, show, r.themes, 'es');
    const en = draftProposal(rec, show, r.themes, 'en');
    expect(es.subject).toMatch(/^Invitación a The Diary Of A CEO/);
    expect(es.body).toMatch(/^Hola, /);
    expect(en.body).toMatch(/^Hi /);
    // Same facts in both: the cited show and month.
    const d = new Date(rec.appearances[0].published);
    for (const p of [es, en]) expect(p.body).toContain(rec.appearances[0].showName);
    expect(en.body).toContain(String(d.getUTCFullYear()));
    expect(es.body).toContain(String(d.getUTCFullYear()));
  });

  it('five letters in a row are not one template: no stock phrase, different openings', async () => {
    const r = await runAgent({ target: byId('diary-of-a-ceo'), others: others('diary-of-a-ceo'), qloo: new NoQlooAdapter() });
    const show = { name: 'The Diary Of A CEO', host: 'Steven Bartlett' };
    for (const lang of ['es', 'en'] as const) {
      const letters = r.recommendations.map((x) => draftProposal(x, show, r.themes, lang).body);
      for (const l of letters) expect(l).not.toMatch(/una y otra vez|keep(s)? (coming|returning) back/);
      const openings = letters.map((l) => l.split('\n')[2]);
      expect(new Set(openings).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('UI dictionary has both languages for every key', () => {
    const src = readFileSync('src/i18n.tsx', 'utf8');
    const entries = [...src.matchAll(/^\s+'([\w.-]+)': \{/gm)].map((m) => m[1]);
    expect(entries.length).toBeGreaterThan(80);
    for (const k of entries) {
      const block = src.slice(src.indexOf(`'${k}': {`), src.indexOf(`'${k}': {`) + 2000);
      expect(block, k).toMatch(/en: /);
      expect(block, k).toMatch(/es: /);
    }
  });
});

describe('guest profiles (photos and bios)', () => {
  it('identity check rejects a namesake and accepts the right person', () => {
    // Real case: Wikipedia's "Shawn Ryan" is a TV screenwriter; DOAC's guest is a different Shawn Ryan.
    expect(contextOverlap('Shawn Ryan', 'Shawn Ryan is an American screenwriter and television producer. The Shield, The Unit, Lie to Me.', ['Shawn Ryan: There’s A Battle For Your Soul, It’s Happening Right Now'])).toEqual([]);
    expect(contextOverlap('Gary Gallagher', 'Gary W. Gallagher is an American historian of the American Civil War.', ['#499 – Gary Gallagher: American Civil War, Slavery, Lincoln, Grant & Lee']).length).toBeGreaterThan(0);
  });

  it('resolves through disambiguation pages only when exactly one option matches', async () => {
    const pages = (titles: string[], extra: Record<string, unknown> = {}) => ({ query: { pages: titles.map((t) => ({ title: t, ...extra })) } });
    const fetchJson = async (url: string): Promise<unknown> => {
      const u = new URL(url);
      const titles = (u.searchParams.get('titles') ?? '').split('|');
      if (u.searchParams.get('prop') === 'links') return { query: { pages: [{ title: 'Michael Levin', links: [{ title: 'Michael Levin (biologist)' }, { title: 'Michael Levin (philosopher)' }] }] } };
      if (u.hostname === 'www.wikidata.org') return { entities: { Q1: { descriptions: { en: { value: 'biologist' }, es: { value: 'biólogo' } } } } };
      if (u.searchParams.get('prop') === 'imageinfo') {
        return { query: { pages: [{ title: 'File:Levin.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x.jpg', thumbwidth: 320, thumbheight: 400, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Levin.jpg', extmetadata: { LicenseShortName: { value: 'CC BY 3.0' }, Artist: { value: '<a>Someone</a>' } } }] }] } };
      }
      if (u.hostname === 'es.wikipedia.org') return { query: { pages: [] } };
      if (titles[0] === 'Michael Levin') return pages(['Michael Levin'], { pageprops: { disambiguation: '' } });
      return {
        query: {
          pages: [
            { title: 'Michael Levin (biologist)', extract: 'Michael Levin is a biologist studying bioelectricity and biological intelligence.', pageimage: 'Levin.jpg', pageprops: { wikibase_item: 'Q1' } },
            { title: 'Michael Levin (philosopher)', extract: 'Michael Levin is a philosopher of ethics.' },
          ],
        },
      };
    };
    const out = await resolveProfiles([{ name: 'Michael Levin', appearanceTitles: ['#486 – Michael Levin: Hidden Reality of Alien Intelligence & Biological Life'] }], fetchJson, '2026-10-22');
    const p = out.get('Michael Levin') as GuestProfile;
    expect(p.wikipedia.title).toBe('Michael Levin (biologist)');
    expect(p.description).toEqual({ en: 'biologist', es: 'biólogo' });
    expect(p.photo).toMatchObject({ license: 'CC BY 3.0', artist: 'Someone' });
  });

  it('matches "F1" in a title with "Fórmula 1" on the page', () => {
    expect(contextOverlap('Toto Wolff', 'director ejecutivo de Mercedes-Benz en Fórmula 1', ['Toto Wolff: F1 Dominance & Hamilton Relationship'])).toContain('formula');
  });

  it('falls back to the Spanish Wikipedia when there is no English page, with the same context check', async () => {
    const fetchJson = async (url: string) => {
      const u = new URL(url);
      const titles = (u.searchParams.get('titles') ?? '').split('|');
      if (u.hostname === 'www.wikidata.org') return { entities: { Q9: { descriptions: { es: { value: 'cantante mexicana' } } } } };
      if (u.searchParams.get('prop') === 'imageinfo') {
        return { query: { pages: [{ title: 'File:Cantante.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/c.jpg', thumbwidth: 320, thumbheight: 400, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cantante.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Alguien' } } }] }] } };
      }
      if (u.hostname === 'en.wikipedia.org') {
        // Ana has no English page; Juan has one, about a namesake sharing nothing with his titles.
        return { query: { pages: titles.map((t) => (t === 'Juan Gómez' ? { title: t, extract: 'Juan Gómez is a Uruguayan footballer.' } : { title: t, missing: true })) } };
      }
      return {
        query: {
          pages: [
            { title: 'Ana Pérez', fullurl: 'https://es.wikipedia.org/wiki/Ana_P%C3%A9rez', extract: 'Ana Pérez es una cantante mexicana de música regional. Ganó varios premios.', pageimage: 'Cantante.jpg', pageprops: { wikibase_item: 'Q9' } },
            { title: 'Juan Gómez', extract: 'Juan Gómez es un futbolista uruguayo.' },
          ],
        },
      };
    };
    const out = await resolveProfiles(
      [
        { name: 'Ana Pérez', appearanceTitles: ['Ana Pérez, cantante: la música que me salvó'] },
        { name: 'Juan Gómez', appearanceTitles: ['Juan Gómez y la economía del miedo'] },
      ],
      fetchJson,
      '2026-10-23',
    );
    const ana = out.get('Ana Pérez') as GuestProfile;
    expect(ana.wikipedia.url).toContain('es.wikipedia.org');
    expect(ana.description.es).toBe('cantante mexicana');
    expect(ana.extract).toMatchObject({ en: null, es: expect.stringContaining('cantante mexicana') });
    expect(ana.photo).toMatchObject({ license: 'CC BY-SA 4.0' });
    // A Spanish page that shares no context with the titles is not attached (possible namesake).
    expect(out.get('Juan Gómez')).toBeNull();
  });

  it('every stored photo has a free license, an author and an https Wikimedia URL', () => {
    const profiles = JSON.parse(readFileSync('data/profiles.json', 'utf8')) as Record<string, GuestProfile>;
    const withPhoto = Object.values(profiles).filter((p) => p.photo);
    expect(withPhoto.length).toBeGreaterThan(20);
    for (const p of withPhoto) {
      expect(p.photo!.thumbUrl).toMatch(/^https:\/\/(upload|thumb)\.wikimedia\.org\//);
      expect(p.photo!.license).toMatch(/CC|Public domain|OGL|PD/i);
      expect(p.photo!.license).not.toMatch(/fair use|non-free/i);
      expect(p.photo!.artist.length).toBeGreaterThan(0);
      expect(p.matchEvidence.length).toBeGreaterThan(0);
    }
  });

  it('recommend responses carry a profile entry (or explicit null) for every recommended guest', async () => {
    const { body } = await handleApi({ action: 'recommend', showId: 'diary-of-a-ceo' }, { PROFILE_LOOKUP: '0' });
    const b = body as { recommendations: Array<{ key: string }>; profiles: Record<string, unknown> };
    for (const r of b.recommendations) expect(r.key in b.profiles).toBe(true);
  });
});
