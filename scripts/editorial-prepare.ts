// Prepares the blind editorial evaluation (docs/EDITORIAL_EVAL.md). Needs the real Qloo key:
//   npm run editorial:prepare                 # all three shows
//   npm run editorial:prepare -- creativo     # one show
// Writes to data/raw/editorial/<run>/ (gitignored):
//   sheet.csv  → give this to raters (no system names, no scores, shuffled, random ids)
//   key.json   → DO NOT open or share until all ratings are in; its hash is printed now
import { mkdirSync, writeFileSync } from 'node:fs';
import { DATASETS } from '../core/api';
import { LiveQlooAdapter } from '../core/qloo/client';
import { loadQlooCredentials, redact } from '../core/qloo/credentials';
import { buildEditorialSet, sheetCsv, sha256, type EditorialKey } from '../core/editorial';

const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const creds = await loadQlooCredentials();
const make = () => new LiveQlooAdapter({ apiKey: creds.apiKey, baseUrl: creds.baseUrl, cache: new Map(), limits: { maxCalls: 400, deadlineMs: 15 * 60_000, concurrency: 4, timeoutMs: 20000 } });

const probe = make();
try {
  await probe.searchPerson('Lex Fridman');
} catch (e) {
  console.error(redact(`Qloo authentication/connection failed: ${String(e)}. No lists produced (list B needs live Qloo).`, creds.apiKey));
  process.exit(3);
}

const { items, lists } = await buildEditorialSet(DATASETS, make, targets.length ? targets : undefined);
const run = `data/raw/editorial/${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(run, { recursive: true });
const sheet = sheetCsv(items);
writeFileSync(`${run}/sheet.csv`, sheet);
const key: EditorialKey = {
  createdAt: new Date().toISOString(),
  design: 'A = top 10 without Qloo; B = top (10 − d) with live Qloo affinity + d ≤ 5 Qloo discoveries; pooled, shuffled, blind.',
  sheetSha256: sha256(sheet),
  lists,
};
const keyText = JSON.stringify(key, null, 1);
writeFileSync(`${run}/key.json`, keyText);
console.log(`Items to rate: ${items.length} (${Object.entries(lists).map(([s, l]) => `${s}: B has ${l.bDiscoveries} discoveries`).join('; ')})`);
console.log(`Rater sheet: ${run}/sheet.csv`);
console.log(`Sealed key:  ${run}/key.json  sha256=${sha256(keyText)}  (write this hash down; do not open the key before scoring)`);
