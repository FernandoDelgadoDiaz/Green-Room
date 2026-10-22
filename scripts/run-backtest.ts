// CLI: npm run backtest -- <showId> <YYYY-MM-DD> [horizonMonths]
import { handleApi } from '../core/api';
import type { BacktestResult } from '../core/backtest';

const [showId = 'diary-of-a-ceo', cutoff = '2025-01-01', horizon = '24'] = process.argv.slice(2);
const { body } = await handleApi({ action: 'backtest', showId, cutoff, horizonMonths: Number(horizon) }, { QLOO_API_KEY: process.env.QLOO_API_KEY, QLOO_BASE_URL: process.env.QLOO_BASE_URL });
const r = body as BacktestResult;
console.log(`${r.targetName} | cutoff ${r.cutoff.slice(0, 10)} → ${r.horizonEnd.slice(0, 10)} | history ${r.historyEpisodes} eps | pool ${r.poolSize}`);
console.log(`hidden first-time guests: ${r.hidden.length} | reachable (in pool at cutoff): ${r.reachable.length} → ${r.reachable.join(', ')}`);
console.log(`leakage audit: ${r.leakage.ok ? 'OK' : 'FAILED'} (max history ${r.leakage.maxHistoryDate.slice(0, 10)}, max pool ${r.leakage.maxPoolDate.slice(0, 10)})`);
console.log(`random expectation: ${Object.entries(r.randomExpectation).map(([k, v]) => `@${k}=${v.toFixed(2)}`).join(' ')}`);
for (const a of r.arms) {
  console.log(`${a.label} [${a.qlooMode}${a.isEvidence ? '' : ', NOT EVIDENCE'}]: ${Object.entries(a.hitsAt).map(([k, v]) => `@${k}=${v}`).join(' ')}`);
  for (const h of a.hits) console.log(`   #${h.rank} ${h.name} — booked ${h.bookedOn.slice(0, 10)}`);
}
