// Builds data/profiles.json (photo + short bio) for people who can appear in recommendations.
//
//   npm run profiles:build
//
// Fetches Wikipedia/Wikidata APIs directly. Responses are cached under data/raw/wiki-cache/ (gitignored).
// In environments without access to those hosts, the script lists the URLs it still needs in
// data/raw/wiki-cache/_missing.txt so they can be fetched by other means and dropped into the cache.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DATASETS } from '../core/api';
import { runAgent } from '../core/agent/agent';
import { NoQlooAdapter } from '../core/qloo/mock';
import { nameKey } from '../core/names';
import { resolveProfiles, type GuestProfile } from '../core/profiles';

const CACHE = 'data/raw/wiki-cache';
mkdirSync(CACHE, { recursive: true });
const missing: string[] = [];

export const cacheFile = (url: string) => `${CACHE}/${createHash('sha1').update(url).digest('hex')}.json`;

async function fetchJson(url: string): Promise<unknown> {
  const f = cacheFile(url);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'GreenRoom/0.1 (hackathon demo; contact via GitHub FernandoDelgadoDiaz)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    writeFileSync(f, JSON.stringify(json));
    return json;
  } catch {
    // Keep going so a single run lists every URL of the current phase; nothing is written this run.
    missing.push(url);
    return {};
  }
}

// People who can appear: top of the current ranking and of the backtest cutoffs, for every show.
const people = new Map<string, { name: string; appearanceTitles: string[] }>();
const titlesByKey = new Map<string, string[]>();
for (const d of DATASETS) for (const e of d.episodes) for (const g of e.guests) titlesByKey.set(nameKey(g.name), [...(titlesByKey.get(nameKey(g.name)) ?? []), e.title]);
for (const t of DATASETS) {
  const others = DATASETS.filter((d) => d.id !== t.id);
  for (const asOf of [undefined, '2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01']) {
    const r = await runAgent({ target: t, others, qloo: new NoQlooAdapter(), asOf: asOf && new Date(asOf).toISOString() });
    for (const x of r.ranked.slice(0, asOf ? 10 : 25)) if (!people.has(x.key)) people.set(x.key, { name: x.name, appearanceTitles: titlesByKey.get(x.key) ?? [] });
  }
}

const retrievedAt = process.env.RETRIEVED_AT ?? new Date().toISOString().slice(0, 10);
const resolved = await resolveProfiles([...people.values()], fetchJson, retrievedAt);
if (missing.length) {
  writeFileSync(`${CACHE}/_missing.txt`, [...new Set(missing)].join('\n') + '\n');
  console.log(`Need ${new Set(missing).size} URL(s); listed in ${CACHE}/_missing.txt. Re-run after caching them.`);
  process.exit(2);
}
{
  const out: Record<string, GuestProfile> = {};
  for (const [name, p] of resolved) if (p) out[nameKey(name)] = p;
  writeFileSync('data/profiles.json', JSON.stringify(out, null, 1) + '\n');
  const withPhoto = Object.values(out).filter((p) => p.photo).length;
  console.log(`${people.size} people → ${Object.keys(out).length} profiles accepted, ${withPhoto} with a free-licensed photo.`);
  const rejected = [...resolved].filter(([, p]) => !p).map(([n]) => n);
  console.log(`No profile (missing, disambiguation or context mismatch): ${rejected.join(', ')}`);
}
