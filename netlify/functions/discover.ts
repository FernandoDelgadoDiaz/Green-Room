// Public endpoint: POST /api/discover. Real Qloo for anyone, no token, inside the shared limits of
// core/public-live/guard.ts. Off unless QLOO_PUBLIC_ENABLED=true (independent of QLOO_LIVE_ENABLED).
// Only status / recommend / analyze exist here; private diagnostics stay on /api/live.
import { handlePublicLive } from '../../core/public-live/handler';
import { blobsStore } from '../../core/public-live/blobs-store';

const ENV_KEYS = [
  'QLOO_PUBLIC_ENABLED',
  'QLOO_API_KEY',
  'QLOO_BASE_URL',
  'PUBLIC_DAILY_QLOO_CALLS',
  'PUBLIC_CALLS_PER_ANALYSIS',
  'PUBLIC_MAX_CONCURRENT',
  'PUBLIC_FRESH_PER_IP_PER_DAY',
  'PUBLIC_OPEN_FEEDS_PER_DAY',
  'PUBLIC_CACHE_HOURS',
  'PUBLIC_IP_SALT',
  'EXTERNAL_VERIFY',
  'EXTERNAL_VERIFY_MAX',
  'PROFILE_LOOKUP',
] as const;

export default async (req: Request, context?: { ip?: string }): Promise<Response> => {
  const headers = { 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405, headers });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }
  const env = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    const { status, body: out } = await handlePublicLive(body, env, { store: blobsStore(), ip: context?.ip ?? req.headers.get('x-nf-client-connection-ip') });
    return Response.json(out, { status, headers });
  } catch {
    return Response.json({ code: 'internal', message: { en: 'Internal error. Nothing was substituted.', es: 'Error interno. No se reemplazó por otro resultado.' }, retry: true }, { status: 500, headers });
  }
};

// Per-IP burst limit at Netlify's edge, on top of the shared daily limits.
export const config = {
  path: '/api/discover',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
