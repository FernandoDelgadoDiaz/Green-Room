// Builds data/people.json: occupation, citizenship, Wikipedia reach and free photo for every guest
// in the catalog, from Wikidata (CC0) and Wikimedia Commons. See core/people.ts for the identity rule.
//
//   npm run people:build
//
// Needs direct access to www.wikidata.org and commons.wikimedia.org (it runs in the GitHub Actions
// workflow "Build people data"). Responses are cached under data/raw/wd-cache/ (gitignored).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ALL_DATASETS } from '../core/datasets';
import { nameKey } from '../core/names';
import { resolvePeople, type GuestToResolve, type PeopleData } from '../core/people';
import catalog from '../data/catalog.json';

const CACHE = 'data/raw/wd-cache';
mkdirSync(CACHE, { recursive: true });
const UA = 'GreenRoom/0.3 (Qloo Agentic Hackathon 2026 demo; https://greenroom1.netlify.app; https://github.com/FernandoDelgadoDiaz/Green-Room)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

async function fetchJson(url: string): Promise<unknown> {
  const f = `${CACHE}/${createHash('sha1').update(url).digest('hex')}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      writeFileSync(f, JSON.stringify(json));
      return json;
    } catch (e) {
      if (attempt === 4) {
        failures++;
        throw e;
      }
      await sleep(1000 * (attempt + 1));
    }
  }
  failures++;
  throw new Error('retries exhausted');
}

const originOf = new Map(catalog.shows.map((s) => [s.id, (s.origin as { country?: string | null }).country ?? null]));
const guests = new Map<string, GuestToResolve>();
for (const d of ALL_DATASETS) {
  const country = originOf.get(d.id);
  for (const e of d.episodes) {
    if (e.excluded) continue;
    for (const g of e.guests) {
      const key = nameKey(g.name);
      if (!key) continue;
      const cur = guests.get(key) ?? { name: g.name, appearanceTitles: [], showCountries: [], languages: [] };
      if (cur.appearanceTitles.length < 8) cur.appearanceTitles.push(e.title);
      if (country && !cur.showCountries.includes(country)) cur.showCountries.push(country);
      if (!cur.languages.includes(d.language)) cur.languages.push(d.language);
      guests.set(key, cur);
    }
  }
}

const list = [...guests.values()];
console.log(`${list.length} guests to resolve`);
const t0 = Date.now();
const { people, stats } = await resolvePeople(list, fetchJson, {
  concurrency: 4,
  onProgress: (done, total) => {
    if (done % 250 === 0 || done === total) console.log(`searched ${done}/${total} (${Math.round((Date.now() - t0) / 1000)} s)`);
  },
});
const out: PeopleData = {
  generatedAt: new Date().toISOString(),
  source: 'Wikidata (CC0) and Wikimedia Commons (photo licenses as credited); identity accepted only with context (core/people.ts).',
  people: Object.fromEntries(Object.entries(people).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync('data/people.json', `${JSON.stringify(out)}\n`);
const withPhoto = Object.values(people).filter((p) => p.photo).length;
console.log(JSON.stringify({ ...stats, withPhoto, fetchFailures: failures, seconds: Math.round((Date.now() - t0) / 1000) }));
