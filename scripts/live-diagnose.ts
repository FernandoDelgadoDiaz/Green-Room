// Private diagnostic against a deployed Green Room (or `npm run dev`), through /api/live.
//   npm run live:diagnose -- <site-url> <auth|t2|t4|t5|status|all> [showId] [cutoff]
// The access token comes from GREENROOM_LIVE_TOKEN or a hidden prompt. The Qloo key never leaves the
// server; responses carry aggregate numbers only.
import { hiddenPrompt } from '../core/qloo/credentials';

const [site, test = 'auth', showId, cutoff] = process.argv.slice(2);
if (!site) {
  console.error('Usage: npm run live:diagnose -- <site-url> <auth|t2|t4|t5|status|all> [showId] [cutoff]');
  process.exit(2);
}
const base = new URL(site);
if (base.protocol !== 'https:' && base.hostname !== 'localhost') {
  console.error('Use https (or localhost): the token must not travel in clear text.');
  process.exit(2);
}
const token = process.env.GREENROOM_LIVE_TOKEN?.trim() || (await hiddenPrompt('Green Room private token (hidden): '));

async function run(t: string, show?: string) {
  const body = t === 'status' ? { action: 'status' } : { action: 'diagnose', test: t, showId: show, cutoff };
  const t0 = Date.now();
  const res = await fetch(new URL('/api/live', base), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: 'non-JSON response' }));
  console.log(`\n== ${t}${show ? ` ${show}` : ''} — HTTP ${res.status} in ${Date.now() - t0} ms`);
  console.log(JSON.stringify(json, null, 1));
  return res.status;
}

if (test === 'all') {
  // Sequential and bounded: 1 status + 1 auth + 3×(t2, t4) + 3×t5 = 11 requests, under the 6/min per-IP limit with pauses.
  const shows = showId ? [showId] : ['lex-fridman', 'diary-of-a-ceo', 'creativo'];
  const plan: Array<[string, string?]> = [['status'], ['auth'], ...shows.flatMap((s) => [['t2', s], ['t4', s], ['t5', s]] as Array<[string, string]>)];
  for (const [i, [t, s]] of plan.entries()) {
    if (i && i % 5 === 0) await new Promise((r) => setTimeout(r, 61_000));
    const st = await run(t, s);
    if (st === 401 || st === 403 || st === 503) break;
  }
} else {
  await run(test, showId);
}
