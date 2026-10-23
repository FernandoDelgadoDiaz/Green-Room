// Private endpoint: POST /api/live. LIVE Qloo only with QLOO_LIVE_ENABLED=true, a key and a valid
// bearer token (see core/access.ts). Strict per-IP rate limit on top of the per-token hourly quota.
import { handleLive, type LiveRequest } from '../../core/api';

const ENV_KEYS = [
  'QLOO_LIVE_ENABLED',
  'QLOO_API_KEY',
  'QLOO_BASE_URL',
  'LIVE_ACCESS_TOKEN_SHA256',
  'LIVE_MAX_ANALYSES_PER_HOUR',
  'QLOO_MAX_CALLS_PER_ANALYSIS',
  'QLOO_MAX_CALLS_PER_DIAGNOSTIC',
  'QLOO_CONCURRENCY',
  'QLOO_TIMEOUT_MS',
  'QLOO_DEADLINE_MS',
  'PROFILE_LOOKUP',
] as const;

export default async (req: Request): Promise<Response> => {
  const headers = { 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405, headers });
  let body: LiveRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }
  const env = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    const { status, body: out } = await handleLive(body, env, req.headers.get('authorization'));
    return Response.json(out, { status, headers });
  } catch {
    // No error text here: it could only come from unexpected code paths.
    return Response.json({ error: 'Internal error' }, { status: 500, headers });
  }
};

export const config = {
  path: '/api/live',
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
