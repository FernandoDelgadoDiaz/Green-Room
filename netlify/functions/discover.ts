// Public endpoint: POST /api/discover. Real Qloo for anyone, no token, inside the shared limits of
// core/public-live/guard.ts. Off unless QLOO_PUBLIC_ENABLED=true (independent of QLOO_LIVE_ENABLED).
// Only status / recommend / analyze / job exist here; private diagnostics stay on /api/live.
// The analysis itself runs in discover-run-background (up to 15 min); this function answers in seconds.
import { handlePublicLive } from '../../core/public-live/handler';
import { blobsStore } from '../../core/public-live/blobs-store';
import { publicEnv } from '../../core/public-live/env';

export default async (req: Request, context?: { ip?: string }): Promise<Response> => {
  const headers = { 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405, headers });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }
  // Starts the background runner; Netlify answers 202 as soon as the invocation is accepted.
  const trigger = async (jobId: string) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(new URL('/api/discover-run', req.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }), signal: ctrl.signal });
      return res.status === 202 || res.ok;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const { status, body: out } = await handlePublicLive(body, publicEnv(), { store: blobsStore(), ip: context?.ip ?? req.headers.get('x-nf-client-connection-ip'), trigger });
    return Response.json(out, { status, headers });
  } catch {
    return Response.json({ code: 'internal', message: { en: 'Internal error. Nothing was substituted.', es: 'Error interno. No se reemplazó por otro resultado.' }, retry: true }, { status: 500, headers });
  }
};

// Per-IP burst limit at Netlify's edge, on top of the shared daily limits. Polling a job is one
// request every few seconds, so the window allows it.
export const config = {
  path: '/api/discover',
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
