import { describe, expect, it } from 'vitest';
import { categoriesOf, resolvePeople } from '../core/people';

// Scripted Wikidata/Commons: two same-name "Sergio Massa" items (an Argentine politician and an
// Italian footballer), one "Ana Gómez" with no context, and occupations/countries/photo lookups.
const entities: Record<string, unknown> = {
  Q1: {
    id: 'Q1',
    labels: { es: { value: 'Sergio Massa' }, en: { value: 'Sergio Massa' } },
    descriptions: { es: { value: 'político argentino' }, en: { value: 'Argentine politician' } },
    claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P106: [{ mainsnak: { datavalue: { value: { id: 'Q82955' } } } }], P27: [{ mainsnak: { datavalue: { value: { id: 'Q414' } } } }], P18: [{ mainsnak: { datavalue: { value: 'Sergio Massa 2023.jpg' } } }] },
    sitelinks: { eswiki: { title: 'Sergio Massa' }, enwiki: { title: 'Sergio Massa' }, frwiki: { title: 'Sergio Massa' }, commonswiki: { title: 'x' } },
  },
  Q2: {
    id: 'Q2',
    labels: { en: { value: 'Sergio Massa' } },
    descriptions: { en: { value: 'Italian footballer' } },
    claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P106: [{ mainsnak: { datavalue: { value: { id: 'Q937857' } } } }], P27: [{ mainsnak: { datavalue: { value: { id: 'Q38' } } } }] },
    sitelinks: { itwiki: { title: 'Sergio Massa (calciatore)' } },
  },
  Q3: {
    id: 'Q3',
    labels: { es: { value: 'Ana Gómez' } },
    descriptions: { es: { value: 'nadadora uruguaya' } },
    claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P27: [{ mainsnak: { datavalue: { value: { id: 'Q77' } } } }] },
    sitelinks: { eswiki: { title: 'Ana Gómez' } },
  },
};
const labels: Record<string, unknown> = {
  Q82955: { id: 'Q82955', labels: { en: { value: 'politician' }, es: { value: 'político' } } },
  Q937857: { id: 'Q937857', labels: { en: { value: 'association football player' }, es: { value: 'futbolista' } } },
};
const countries: Record<string, unknown> = {
  Q414: { id: 'Q414', claims: { P297: [{ mainsnak: { datavalue: { value: 'AR' } } }] } },
  Q38: { id: 'Q38', claims: { P297: [{ mainsnak: { datavalue: { value: 'IT' } } }] } },
  Q77: { id: 'Q77', claims: { P297: [{ mainsnak: { datavalue: { value: 'UY' } } }] } },
};

const fetchJson = async (url: string) => {
  const u = new URL(url);
  const action = u.searchParams.get('action');
  if (u.hostname === 'commons.wikimedia.org') {
    return { query: { pages: [{ title: 'File:Sergio Massa 2023.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/m.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Sergio_Massa_2023.jpg', extmetadata: { LicenseShortName: { value: 'CC BY 2.0' }, Artist: { value: '<a>Casa Rosada</a>' } } }] }] } };
  }
  if (action === 'wbsearchentities') {
    const q = u.searchParams.get('search');
    if (q === 'Sergio Massa') return { search: [{ id: 'Q1', label: 'Sergio Massa' }, { id: 'Q2', label: 'Sergio Massa' }] };
    if (q === 'Ana Gómez') return { search: [{ id: 'Q3', label: 'Ana Gómez' }] };
    return { search: [] };
  }
  const ids = (u.searchParams.get('ids') ?? '').split('|');
  const pool = { ...entities, ...labels, ...countries } as Record<string, unknown>;
  return { entities: Object.fromEntries(ids.filter((id) => pool[id]).map((id) => [id, pool[id]])) };
};

describe('people (Wikidata) resolution', () => {
  it('picks the same-name person with context, and leaves out a namesake with none', async () => {
    const { people, stats } = await resolvePeople(
      [
        { name: 'Sergio Massa', appearanceTitles: ['#68 - Sergio Massa'], showCountries: ['ar'], languages: ['es'] },
        { name: 'Ana Gómez', appearanceTitles: ['#12 - Ana Gómez'], showCountries: ['ar'], languages: ['es'] },
        { name: 'Nadie Conocido', appearanceTitles: ['#1 - Nadie Conocido'], showCountries: ['ar'], languages: ['es'] },
      ],
      fetchJson,
    );
    const massa = people['sergio massa'];
    expect(massa.qid).toBe('Q1');
    expect(massa.categories).toEqual(['politics']);
    expect(massa.countries).toEqual(['ar']);
    expect(massa.wikipedias).toBe(3);
    expect(massa.articles.sort()).toEqual(['enwiki', 'eswiki', 'frwiki']);
    expect(massa.photo).toMatchObject({ license: 'CC BY 2.0', artist: 'Casa Rosada' });
    expect(massa.match).toContain('country');
    // Uruguayan swimmer, on an Argentine show, with no shared words: not attached.
    expect(people['ana gomez']).toBeUndefined();
    expect(stats).toMatchObject({ resolved: 1, noContext: 1, notFound: 1 });
  });

  it('maps Wikidata occupations to categories', () => {
    expect(categoriesOf(['singer-songwriter', 'actor'])).toEqual(['music', 'acting']);
    expect(categoriesOf(['YouTuber'])).toEqual(['media']);
    expect(categoriesOf(['association football player'])).toEqual(['sports']);
    expect(categoriesOf(['plumber'])).toEqual([]);
  });

  it('never takes a namesake who died before the guest was interviewed', async () => {
    const dead = { ...(entities.Q1 as object), id: 'Q1', claims: { ...(entities.Q1 as { claims: object }).claims, P570: [{ mainsnak: { datavalue: { value: { time: '+1990-01-01T00:00:00Z' } } } }] } };
    const fetchDead = async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.get('action') === 'wbgetentities' && (u.searchParams.get('ids') ?? '').includes('Q1')) {
        const r = (await fetchJson(url)) as { entities: Record<string, unknown> };
        return { entities: { ...r.entities, Q1: dead } };
      }
      return fetchJson(url);
    };
    const { people } = await resolvePeople([{ name: 'Sergio Massa', appearanceTitles: ['#68 - Sergio Massa'], showCountries: ['ar'], languages: ['es'], firstInterview: '2024-02-28' }], fetchDead);
    expect(people['sergio massa']).toBeUndefined();
  });
});
