// Public endpoint: POST /api/agent. Always MOCK (see core/api.ts handleApi); never touches the Qloo key.
import { handleApi, type ApiRequest } from '../../core/api';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });
  let body: ApiRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const { status, body: out } = await handleApi(body, { PROFILE_LOOKUP: process.env.PROFILE_LOOKUP });
    return Response.json(out, { status });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
};

// Netlify code-based rate limit (available on all plans): per IP and domain.
export const config = {
  path: '/api/agent',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
