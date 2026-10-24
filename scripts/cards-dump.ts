// Every card's visible text for every catalog show (no Qloo calls), to review the copy by eye.
//
//   npx tsx scripts/cards-dump.ts [es|en] [showId ...]

import { DATASETS, ORIGIN_OF, PEOPLE } from '../core/api';
import { runAgent } from '../core/agent/agent';
import { NoQlooAdapter } from '../core/qloo/mock';
import { audienceSubtitle, citableThemes, whySentences } from '../src/why';
import { cleanTopic } from '../core/topic';

const lang = (process.argv[2] === 'en' ? 'en' : 'es') as 'en' | 'es';
const only = process.argv.slice(3);
for (const target of DATASETS.filter((d) => !only.length || only.includes(d.id))) {
  const r = await runAgent({ target, others: DATASETS.filter((d) => d.id !== target.id), qloo: new NoQlooAdapter(), k: 5, originOf: ORIGIN_OF, people: PEOPLE });
  console.log(`\n=== ${target.id} · ${target.name} [${ORIGIN_OF.get(target.id) ?? '?'}]`);
  for (const rec of r.recommendations) {
    console.log(`${rec.rank}. ${rec.name} — ${audienceSubtitle(rec, lang) ?? '(sin subtítulo)'}`);
    console.log(`   WHY: ${whySentences(rec, target.name, lang).join(' ')}`);
    const topics = [...rec.conversationTopics.map((t) => cleanTopic(t)).filter((t): t is string => Boolean(t)), ...citableThemes(rec).map((s) => (lang === 'es' ? s.labelEs : s.label))];
    console.log(`   TOPICS: ${topics.join(' | ')}`);
  }
}
