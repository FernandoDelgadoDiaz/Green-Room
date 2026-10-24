// Snapshots the official RSS feed of catalog shows that have no dataset yet (data/catalog/sources.json
// entries without data/podcasts/<id>.json), into data/raw/catalog/<id>.xml (gitignored), for
// scripts/build-catalog.ts. Runs in the "Build catalog data" workflow, where feed hosts are reachable.
//
//   npx tsx scripts/fetch-rss.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const UA = 'GreenRoom/0.3 (Qloo Agentic Hackathon 2026 demo; https://greenroom1.netlify.app)';
const src = JSON.parse(readFileSync('data/catalog/sources.json', 'utf8')) as { shows: Array<{ id: string; feedUrl: string; spotifyId?: string; notAnalyzable?: string; existing?: boolean }> };
mkdirSync('data/raw/catalog', { recursive: true });
for (const s of src.shows) {
  if (s.existing || s.spotifyId || s.notAnalyzable || existsSync(`data/podcasts/${s.id}.json`) || existsSync(`data/raw/catalog/${s.id}.xml`)) continue;
  try {
    const res = await fetch(s.feedUrl, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    if (!/<rss[\s>]/i.test(xml)) throw new Error('not an RSS document');
    writeFileSync(`data/raw/catalog/${s.id}.xml`, xml);
    console.log(`${s.id.padEnd(24)} ${(xml.length / 1e6).toFixed(1)} MB`);
  } catch (e) {
    console.error(`${s.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
