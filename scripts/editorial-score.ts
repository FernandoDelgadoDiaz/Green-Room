// Scores the blind editorial evaluation once every rater has filled a copy of sheet.csv:
//   npm run editorial:score -- data/raw/editorial/<run> ana.csv bruno.csv
// Each CSV's file name (without .csv) is used as the rater id.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ratingsFromCsv, scoreEditorial, sha256, type EditorialKey } from '../core/editorial';

const [run, ...files] = process.argv.slice(2);
if (!run || !files.length) {
  console.error('Usage: npm run editorial:score -- <run dir> <rater1.csv> [rater2.csv …]');
  process.exit(2);
}
const keyText = readFileSync(`${run}/key.json`, 'utf8');
const key = JSON.parse(keyText) as EditorialKey;
if (sha256(readFileSync(`${run}/sheet.csv`, 'utf8')) !== key.sheetSha256) console.warn('Warning: sheet.csv changed after the key was sealed.');
const ratings = files.flatMap((f) => ratingsFromCsv(readFileSync(f, 'utf8'), basename(f, '.csv')));
console.log(`key sha256=${sha256(keyText)} (compare with the hash printed at preparation)`);
console.log(JSON.stringify(scoreEditorial(key, ratings), null, 1));
