import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only: serves POST /api/agent with the same handler as the Netlify Function, so the Qloo key
// stays server-side in development too.
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'green-room-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/agent', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try {
          const { handleApi } = await server.ssrLoadModule('/core/api.ts');
          const { status, body } = await handleApi(JSON.parse(raw || '{}'), { QLOO_API_KEY: env.QLOO_API_KEY, QLOO_BASE_URL: env.QLOO_BASE_URL, PROFILE_LOOKUP: env.PROFILE_LOOKUP });
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Third argument '' loads non-VITE_ vars for the server only; they are never injected into client code.
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [react(), devApi(env)] };
});
