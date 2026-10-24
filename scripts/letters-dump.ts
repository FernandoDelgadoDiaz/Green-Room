// Who-they-are block and invitation letter for every pick of the given shows (no Qloo calls).
//
//   npx tsx scripts/letters-dump.ts [es|en] showId ...

import { DATASETS, ORIGIN_OF, PEOPLE } from '../core/api';
import { runAgent } from '../core/agent/agent';
import { NoQlooAdapter } from '../core/qloo/mock';
import { draftProposal } from '../core/pitch';
import { whoTheyAre, whySentences } from '../src/why';

const lang = (process.argv[2] === 'en' ? 'en' : 'es') as 'en' | 'es';
for (const id of process.argv.slice(3)) {
  const target = DATASETS.find((d) => d.id === id)!;
  const r = await runAgent({ target, others: DATASETS.filter((d) => d.id !== id), qloo: new NoQlooAdapter(), k: 5, originOf: ORIGIN_OF, people: PEOPLE });
  console.log(`\n=== ${target.name}`);
  for (const rec of r.recommendations) {
    const w = whoTheyAre(rec, lang);
    console.log(`\n--- ${rec.rank}. ${rec.name}`);
    console.log(`WHO: ${w.bio ?? '-'}\n     now: ${w.position ?? '-'} | awards: ${w.awards ?? '-'}`);
    console.log(`WHY: ${whySentences(rec, target.name, lang).join(' ')}`);
    console.log(draftProposal(rec, { name: target.name, host: target.host }, r.themes, lang).body);
  }
}
