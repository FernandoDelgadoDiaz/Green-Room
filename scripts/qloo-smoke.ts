// Live validation of the Qloo hackathon API — run the day the key arrives:
//   QLOO_API_KEY=... npm run qloo:smoke
// Implements tests T1–T5 and T9 from the research plan. Prints counts and field names only;
// it never writes Qloo responses to disk (they must not end up in a public repo).

import { readFileSync } from 'node:fs';
import { LiveQlooAdapter, QLOO_HACKATHON_BASE_URL } from '../core/qloo/client';
import { sameName } from '../core/names';
import type { PodcastDataset } from '../core/types';

const key = process.env.QLOO_API_KEY;
if (!key) {
  console.error('Set QLOO_API_KEY first (server-side env var; never commit it).');
  process.exit(1);
}
const baseUrl = process.env.QLOO_BASE_URL || QLOO_HACKATHON_BASE_URL;
const q = new LiveQlooAdapter({ apiKey: key, baseUrl });

async function raw(path: string, params: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'X-Api-Key': key! } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function shape(v: unknown, depth = 0): string {
  if (Array.isArray(v)) return `[${v.length ? shape(v[0], depth + 1) : ''}]`;
  if (v && typeof v === 'object' && depth < 3) return `{${Object.keys(v).slice(0, 12).map((k) => `${k}:${shape((v as Record<string, unknown>)[k], depth + 1)}`).join(', ')}}`;
  return typeof v;
}

const results: Array<[string, boolean, string]> = [];
const record = (id: string, ok: boolean, info: string) => {
  results.push([id, ok, info]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${info}`);
};

// T1 connectivity + response shape (to confirm the parser in core/qloo/client.ts)
const t1 = await raw('/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.tags': 'urn:tag:genre:media:comedy', take: '10' });
record('T1 connectivity', t1.status === 200, `HTTP ${t1.status}; shape ${shape(t1.body)}`);

// T2 person coverage for real guests of each show
const shows = ['lex-fridman', 'diary-of-a-ceo', 'creativo'].map((id) => JSON.parse(readFileSync(`data/podcasts/${id}.json`, 'utf8')) as PodcastDataset);
const resolvedByShow = new Map<string, string[]>();
for (const s of shows) {
  const guests = [...new Set(s.episodes.flatMap((e) => e.guests.map((g) => g.name)))].slice(0, 30);
  const ids: string[] = [];
  for (const g of guests) {
    const hits = await q.searchPerson(g).catch(() => []);
    const m = hits.find((h) => sameName(h.name, g));
    if (m) ids.push(m.entityId);
  }
  resolvedByShow.set(s.id, ids);
  record(`T2 person coverage ${s.id}`, ids.length / guests.length >= 0.7, `${ids.length}/${guests.length} recent guests resolved`);
}

// T3 podcast entities
const podcastHits = await Promise.all(shows.map((s) => raw('/search', { query: s.name, types: 'urn:entity:podcast', take: '3' })));
record('T3 podcast entities', podcastHits.every((h) => h.status === 200), podcastHits.map((h, i) => `${shows[i].name}: ${shape(h.body)}`).join(' | '));

// T4 person insights with exclusion
const lexIds = resolvedByShow.get('lex-fridman') ?? [];
if (lexIds.length >= 3) {
  const people = await q.personInsights({ signalIds: lexIds.slice(0, 10), excludeIds: lexIds.slice(0, 10), take: 20 });
  const leaked = people.filter((p) => lexIds.includes(p.entityId)).length;
  record('T4 person insights + exclusion', people.length > 0 && leaked === 0, `${people.length} people, ${leaked} excluded ids leaked; sample: ${people.slice(0, 5).map((p) => p.name).join(', ')}`);
  // T9 explainability field presence
  const t9 = await raw('/v2/insights', { 'filter.type': 'urn:entity:person', 'signal.interests.entities': lexIds.slice(0, 5).join(','), 'feature.explainability': 'true', take: '3' });
  record('T9 explainability', t9.status === 200 && JSON.stringify(t9.body).includes('explain'), `HTTP ${t9.status}; shape ${shape(t9.body)}`);
} else {
  record('T4 person insights + exclusion', false, 'skipped: fewer than 3 Lex guests resolved');
}

console.log('\nT5 (backtest with live Qloo): run `npm run backtest -- diary-of-a-ceo 2025-01-01` with QLOO_API_KEY set and compare arms.');
console.log(`\nSummary: ${results.filter((r) => r[1]).length}/${results.length} passed.`);
