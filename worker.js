// Worker entry for Cloudflare Workers (replacing the Pages setup).
// Static files come from dist/ via the assets binding; the one API route
// reuses the Pages-style handler in functions/.
import { onRequest } from './functions/api/progress/[[code]].js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/progress(?:\/([^/]*))?$/);
    if (match) {
      const params = { code: match[1] ? [match[1]] : [] };
      return onRequest({ request, env, params });
    }
    if (!env.ASSETS) return new Response("assets not configured", { status: 503 });
    return env.ASSETS.fetch(request);
  },
};
