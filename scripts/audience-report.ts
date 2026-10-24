// Top picks for every catalog show with people data (no Qloo calls), to review the ranking by eye.
//
//   npx tsx scripts/audience-report.ts [showId ...]

import { DATASETS, ORIGIN_OF, PEOPLE } from '../core/api';
import { runAgent } from '../core/agent/agent';
import { NoQlooAdapter } from '../core/qloo/mock';
import { audienceSubtitle, whySentences } from '../src/why';

const only = process.argv.slice(2);
for (const target of DATASETS.filter((d) => !only.length || only.includes(d.id))) {
  const r = await runAgent({ target, others: DATASETS.filter((d) => d.id !== target.id), qloo: new NoQlooAdapter(), k: 5, originOf: ORIGIN_OF, people: PEOPLE });
  const g = r.guestProfile;
  console.log(`\n=== ${target.name} [${ORIGIN_OF.get(target.id) ?? '?'}] guests ${g?.resolved}/${g?.pastGuests} strong=${g?.strong} weakThemes=${g?.themesWeak} gate=${g?.gateLevel}`);
  if (g) console.log(`    profile: ${g.categories.map((c) => `${c.id} ${Math.round(c.share * 100)}% (${c.examples.join(', ')})`).join('; ')}`);
  for (const rec of r.recommendations) {
    console.log(`  ${rec.rank}. ${rec.name} — ${audienceSubtitle(rec, 'es') ?? 'sin registro'} · ${rec.audience?.wikipedias ?? 0} wikis · score ${rec.score.toFixed(2)}`);
    console.log(`     ${whySentences(rec, target.name, 'es').join(' ')}`);
  }
}
