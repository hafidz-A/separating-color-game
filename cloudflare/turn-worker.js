// Cloudflare Worker that hands out short-lived relay (TURN) credentials to the
// game at /api/turn. Your TURN key's API token stays secret inside the Worker;
// the browser only ever sees credentials that expire after 24 hours.
//
// Deployed from this repository (wrangler.jsonc), the same Worker also serves
// the game itself; every other path is answered from the static files.
//
// Worker settings (Settings → Variables and Secrets):
//   TURN_KEY_ID          (Text)    – the TURN key ID from Realtime → TURN Server
//   TURN_KEY_API_TOKEN   (Secret)  – that TURN key's API token
//   ALLOWED_ORIGINS      (Text, optional) – comma-separated sites allowed to ask,
//                                   default https://hafidz-a.github.io

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // With static assets attached, only /api/turn is handled here.
    if (env.ASSETS && url.pathname !== '/api/turn') return env.ASSETS.fetch(request);

    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://hafidz-a.github.io').split(',').map((s) => s.trim());
    const sameSite = origin === url.origin || (!origin && request.headers.get('Sec-Fetch-Site') === 'same-origin');
    const ok = sameSite || allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': ok && origin ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!ok) return new Response('Forbidden', { status: 403, headers: cors });
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      return new Response('TURN_KEY_ID / TURN_KEY_API_TOKEN not set', { status: 500, headers: cors });
    }

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      },
    );
    if (!res.ok) return new Response('Could not create TURN credentials', { status: 502, headers: cors });
    const data = await res.json();

    // Browsers block port 53, so drop those relay addresses.
    const servers = (data.iceServers || [])
      .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
    return Response.json(servers, { headers: cors });
  },
};
