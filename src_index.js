// ============================================================
// EV Scout — CORS proxy (Cloudflare Worker)
// One worker fronts both upstreams:
//   /odds/...    -> https://api.the-odds-api.com/...
//   /kalshi/...  -> https://api.elections.kalshi.com/...
// It adds the CORS headers the browser needs and passes the
// quota headers back through. Optional shared-secret via ?token=.
// ============================================================

const UPSTREAMS = {
  odds: "https://api.the-odds-api.com",
  kalshi: "https://api.elections.kalshi.com",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // lets the browser READ these cross-origin (quota counters)
  "Access-Control-Expose-Headers": "x-requests-remaining, x-requests-used",
};

export default {
  async fetch(request, env) {
    // Browser preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    // Optional gate: set PROXY_TOKEN in the worker's env vars,
    // then call the worker with &token=YOUR_SECRET. Strips it
    // before forwarding so it never reaches the upstream.
    if (env && env.PROXY_TOKEN) {
      if (url.searchParams.get("token") !== env.PROXY_TOKEN) {
        return json({ error: "unauthorized" }, 401);
      }
      url.searchParams.delete("token");
    }

    // First path segment selects the upstream.
    const parts = url.pathname.split("/").filter(Boolean);
    const upstream = UPSTREAMS[parts[0]];
    if (!upstream) {
      return json({ error: "route with /odds/... or /kalshi/..." }, 404);
    }

    const rest = "/" + parts.slice(1).join("/");
    const targetUrl = upstream + rest + url.search;

    try {
      const res = await fetch(targetUrl, { headers: { Accept: "application/json" } });
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: {
          ...CORS,
          "Content-Type": res.headers.get("Content-Type") || "application/json",
          "x-requests-remaining": res.headers.get("x-requests-remaining") || "",
          "x-requests-used": res.headers.get("x-requests-used") || "",
        },
      });
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
