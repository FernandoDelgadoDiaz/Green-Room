// Photos for people Qloo proposed: Wikidata P18 → Wikimedia Commons, free licenses only, with credit.
import { describe, expect, it } from 'vitest';
import { WikidataVerifier } from '../core/verify/external';
import { commonsPhotos } from '../core/profiles';

const claim = (value: unknown) => [{ mainsnak: { datavalue: { value } } }];

describe('photos for Qloo proposals', () => {
  it('reads the Commons file from Wikidata P18 when Qloo links the record', async () => {
    const fetchJson = async (url: string) => {
      if (url.includes('wbgetentities') && url.includes('Q1')) {
        return {
          entities: {
            Q1: { id: 'Q1', labels: { en: { value: 'Ben Horowitz' } }, sitelinks: { enwiki: { title: 'Ben Horowitz' } }, claims: { P31: claim({ id: 'Q5' }), P18: claim('Ben Horowitz 2014.jpg') } },
          },
        };
      }
      return {};
    };
    const [c] = await new WikidataVerifier({ fetchJson }).verify([{ entity: { entityId: 'q', name: 'Ben Horowitz', wikidataIds: ['Q1'] } }], { targetLang: 'en' });
    expect(c.photoFile).toBe('Ben Horowitz 2014.jpg');
  });

  it('keeps free images with author and license, and drops non-free ones', async () => {
    const page = (title: string, license: string) => ({
      title: `File:${title}`,
      imageinfo: [{ thumburl: `https://upload.wikimedia.org/${title}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}`, extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="x">Jane Doe</a>' } } }],
    });
    const urls: string[] = [];
    const photos = await commonsPhotos(['Ben Horowitz 2014.jpg', 'Logo.png'], async (u) => {
      urls.push(u);
      return { query: { pages: [page('Ben Horowitz 2014.jpg', 'CC BY-SA 4.0'), page('Logo.png', 'Fair use')] } };
    });
    expect(urls).toHaveLength(1);
    expect(photos.get('Ben_Horowitz_2014.jpg')).toMatchObject({ license: 'CC BY-SA 4.0', artist: 'Jane Doe', filePage: 'https://commons.wikimedia.org/wiki/File:Ben Horowitz 2014.jpg' });
    expect(photos.has('Logo.png')).toBe(false);
  });
});
