import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only: serves POST /api/agent (public, MOCK) and POST /api/live (private) with the same handlers
// as the Netlify Functions, so the Qloo key stays server-side in development too.
function devApi(env: Record<string, string>): Plugin {
  const route =
    (path: '/api/agent' | '/api/live' | '/api/podcasts') =>
    async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        return res.end();
      }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try {
        const mod = await server!.ssrLoadModule('/core/api.ts');
        const body = JSON.parse(raw || '{}');
        const out =
          path === '/api/agent'
            ? await mod.handleApi(body, { PROFILE_LOOKUP: env.PROFILE_LOOKUP })
            : path === '/api/podcasts'
              ? await (await server!.ssrLoadModule('/core/podcasts-api.ts')).handlePodcasts(body, { PROFILE_LOOKUP: env.PROFILE_LOOKUP })
              : await mod.handleLive(body, env, req.headers.authorization);
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(out.body));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: path === '/api/agent' ? String(err) : 'Internal error' }));
      }
    };
  let server: ViteDevServer | undefined;
  return {
    name: 'green-room-dev-api',
    configureServer(s) {
      server = s;
      s.middlewares.use('/api/agent', route('/api/agent'));
      s.middlewares.use('/api/live', route('/api/live'));
      s.middlewares.use('/api/podcasts', route('/api/podcasts'));
    },
  };
}

export default defineConfig(({ mode }) => {
  // Third argument '' loads non-VITE_ vars for the server only; they are never injected into client code.
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [react(), devApi(env)] };
});
