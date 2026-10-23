// Performance of the LIVE pipeline against a SIMULATED Qloo (fixed latency, documented response
// shapes). It measures our orchestration — concurrency, budget, deadline — not Qloo's real latency.
//   npm run perf:sim
import { handleLive } from '../core/api';
import { sha256Hex } from '../core/access';

const TOKEN = 'perf-simulation-token-0123456789abcdefghij';
let latency = 0;
globalThis.fetch = (async (input: string | URL, init?: { signal?: AbortSignal }) => {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, latency);
    init?.signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))));
  });
  const u = new URL(String(input));
  const body =
    u.pathname === '/search'
      ? { results: [{ entity_id: `p:${u.searchParams.get('query')}`, name: u.searchParams.get('query') }] }
      : { results: { entities: (u.searchParams.get('filter.results.entities') ?? '').split(',').filter(Boolean).map((id) => ({ entity_id: id, name: id.slice(2), query: { affinity: 0.5 } })) } };
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const rows: string[] = ['| simulated latency | concurrency | request | HTTP | Qloo calls | max in flight | elapsed |', '|---|---|---|---|---|---|---|'];
let n = 0;
for (const ms of [150, 400, 800]) {
  for (const concurrency of ['1', '6']) {
    latency = ms;
    for (const [label, req] of [
      ['recommend DOAC', { action: 'recommend', showId: 'diary-of-a-ceo' }],
      ['diagnose t5 DOAC 2025-01-01', { action: 'diagnose', test: 't5', showId: 'diary-of-a-ceo', cutoff: '2025-01-01' }],
    ] as const) {
      // A fresh token per run gives each run an empty quota and the cache is defeated by unique names.
      const token = `${TOKEN}-${n++}`;
      const env = { QLOO_LIVE_ENABLED: 'true', QLOO_API_KEY: 'sim', QLOO_BASE_URL: `https://sim${n}.qloo.com`, LIVE_ACCESS_TOKEN_SHA256: sha256Hex(token), QLOO_CONCURRENCY: concurrency, PROFILE_LOOKUP: '0' };
      const t0 = Date.now();
      const r = await handleLive(req as never, env, `Bearer ${token}`);
      const m = (r.body as { qlooMetrics?: { networkCalls: number; maxInFlight: number } }).qlooMetrics;
      rows.push(`| ${ms} ms | ${concurrency} | ${label} | ${r.status} | ${m?.networkCalls ?? '-'} | ${m?.maxInFlight ?? '-'} | ${((Date.now() - t0) / 1000).toFixed(1)} s |`);
    }
  }
}
console.log(rows.join('\n'));
console.log('\nSimulation only. Deadline 45 s per request (Netlify synchronous limit: 60 s).');
