// Public endpoint: POST /api/podcasts. Open search of podcasts outside the catalog (core/podcasts-api.ts).
// Outbound requests are SSRF-checked and capped per request; Qloo stays MOCK here.
import { handlePodcasts, type PodcastsRequest } from '../../core/podcasts-api';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });
  let body: PodcastsRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const { status, body: out } = await handlePodcasts(body, { PROFILE_LOOKUP: process.env.PROFILE_LOOKUP });
    return Response.json(out, { status });
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
};

// Stricter than /api/agent: every call can reach external sources.
export const config = {
  path: '/api/podcasts',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
