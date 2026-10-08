const CHECKS = [
  {
    key: "tv",
    uuid: "2ed68968-3302-44ac-92a2-bbc9772bfd7b",
    label: "tv-home-server",
  },
  {
    key: "gaming",
    uuid: "cce31621-3da3-4507-acb1-0abac53458ca",
    label: "gaming-home-server",
  },
];

const WINDOW_SECONDS = 30 * 24 * 3600; // 30 days
const FLIP_LOOKBACK_SECONDS = 90 * 24 * 3600;

const CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "connect-src 'self' https://healthchecks.io https://cloudflareinsights.com https://static.cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "synapse.landonprojects.com") {
      return withSecurityHeaders(await synapseResponse(request, env, url));
    }

    if (url.pathname === "/synapse" || url.pathname.startsWith("/synapse/")) {
      return withSecurityHeaders(await notFound(request, env));
    }

    const response =
      url.pathname === "/api/uptime"
        ? await handleUptime(env)
        : await env.ASSETS.fetch(request);

    return withSecurityHeaders(response);
  },
};

const SYNAPSE_PAGES = {
  "/": "/synapse/",
  "/index.html": "/synapse/",
  "/terms": "/synapse/terms",
  "/privacy": "/synapse/privacy",
  "/status": "/synapse/status",
  "/status.html": "/synapse/status",
  "/logo.png": "/synapse/logo.png",
  "/og.png": "/synapse/og.png",
  "/site.css": "/synapse/site.css",
  "/terms.pdf": "/synapse/terms.pdf",
  "/privacy.pdf": "/synapse/privacy.pdf",
};

async function synapseResponse(request, env, url) {
  if (url.pathname === "/api/synapse-status") {
    return handleSynapseStatus(env);
  }

  const page = SYNAPSE_PAGES[url.pathname] || null;

  if (!page) {
    return notFound(request, env, "/synapse/404");
  }

  const assetUrl = new URL(request.url);
  assetUrl.pathname = page;
  return env.ASSETS.fetch(new Request(assetUrl, request));
}

async function notFound(request, env, pathname = "/404") {
  const notFoundUrl = new URL(request.url);
  notFoundUrl.pathname = pathname;
  const page = await env.ASSETS.fetch(new Request(notFoundUrl, request));
  return new Response(page.body, {
    status: 404,
    statusText: "Not Found",
    headers: page.headers,
  });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function mapSynapseHcStatus(hcStatus) {
  if (hcStatus === "up") return "up";
  if (hcStatus === "down" || hcStatus === "grace") return "down";
  return "unknown";
}

async function handleSynapseStatus(env) {
  const checkedAt = new Date().toISOString();
  const uuid = env.SYNAPSE_HC_UUID || env.HC_SYNAPSE_UUID;
  const apiKey = env.HC_API_KEY;

  if (!apiKey || !uuid) {
    return json({
      status: "unknown",
      lastPing: null,
      checkedAt,
      uptime30d: null,
      days: [],
      hcLatencyMs: null,
      reason: !apiKey ? "missing_key" : "missing_uuid",
    });
  }

  try {
    const headers = { "X-Api-Key": apiKey };
    const started = Date.now();
    const checkRes = await fetch(
      `https://healthchecks.io/api/v3/checks/${uuid}`,
      { headers },
    );
    const hcLatencyMs = Date.now() - started;
    if (!checkRes.ok) {
      return json({
        status: "unknown",
        lastPing: null,
        checkedAt,
        uptime30d: null,
        days: [],
        hcLatencyMs,
        reason: `hc_${checkRes.status}`,
      });
    }
    const check = await checkRes.json();
    const now = Math.floor(Date.now() / 1000);
    const flipsRes = await fetch(
      `https://healthchecks.io/api/v3/checks/${uuid}/flips/?start=${now - FLIP_LOOKBACK_SECONDS}`,
      { headers },
    );
    const flips = flipsRes.ok ? normalizeFlips(await flipsRes.json()) : [];
    const start = historyStart(now, check, flips);
    const uptime30d = computeUptime(flips, start, now, check.status);
    const days = buildDailyUptime(flips, start, now, check.status);
    return json({
      status: mapSynapseHcStatus(check.status),
      name: check.name || "Synapse",
      lastPing: check.last_ping || null,
      checkedAt,
      uptime30d,
      days,
      hcLatencyMs,
      trackedSince: new Date(start * 1000).toISOString(),
    });
  } catch {
    return json({
      status: "unknown",
      lastPing: null,
      checkedAt,
      uptime30d: null,
      days: [],
      hcLatencyMs: null,
      reason: "fetch_failed",
    });
  }
}

async function handleUptime(env) {
  if (!env.HC_API_KEY) {
    return json({ error: "HC_API_KEY not configured" }, 500);
  }

  const now = Math.floor(Date.now() / 1000);
  const headers = { "X-Api-Key": env.HC_API_KEY };
  const results = {};

  await Promise.all(
    CHECKS.map(async (c) => {
      try {
        const checkRes = await fetch(
          `https://healthchecks.io/api/v3/checks/${c.uuid}`,
          { headers },
        );
        if (!checkRes.ok)
          throw new Error("check fetch failed: " + checkRes.status);
        const check = await checkRes.json();
        const flipsRes = await fetch(
          `https://healthchecks.io/api/v3/checks/${c.uuid}/flips/?start=${now - FLIP_LOOKBACK_SECONDS}`,
          { headers },
        );
        if (!flipsRes.ok)
          throw new Error("flips fetch failed: " + flipsRes.status);
        const flips = normalizeFlips(await flipsRes.json());
        const start = historyStart(now, check, flips);

        results[c.key] = {
          label: c.label,
          status: check.status,
          last_ping: check.last_ping || null,
          uptime_30d: computeUptime(flips, start, now, check.status),
          days: buildDailyUptime(flips, start, now, check.status),
          tracked_since: new Date(start * 1000).toISOString(),
        };
      } catch (err) {
        results[c.key] = {
          label: c.label,
          status: "unknown",
          last_ping: null,
          uptime_30d: null,
          days: [],
          tracked_since: null,
        };
      }
    }),
  );

  return json(results);
}

function toUnix(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

function normalizeFlips(raw) {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.flips)
      ? raw.flips
      : [];
  return list
    .map((flip) => ({
      t: toUnix(flip.timestamp),
      up: flip.up === 1 || flip.up === true ? 1 : 0,
    }))
    .filter((flip) => flip.t != null)
    .sort((a, b) => a.t - b.t);
}

function isUpStatus(status) {
  return status === "up" || status === "grace";
}

function historyStart(now, check, flips) {
  const floor = now - WINDOW_SECONDS;
  const created = toUnix(check?.created);
  let start = created != null ? Math.max(floor, created) : floor;

  const prior = flips.filter((flip) => flip.t <= floor);
  if (prior.length === 0) {
    const firstUp = flips.find((flip) => flip.t > floor && flip.up === 1);
    if (firstUp) {
      const downBeforeUp = flips.some(
        (flip) => flip.t < firstUp.t && flip.up === 0,
      );
      if (!downBeforeUp) start = Math.max(start, firstUp.t);
    }
  }

  return start;
}

function stateBefore(flips, start, currentStatus) {
  let state = null;
  for (const flip of flips) {
    if (flip.t <= start) state = flip.up;
    else break;
  }
  if (state != null) return state;
  if (flips.length > 0 && flips[0].t > start) {
    return flips[0].up ? 0 : 1;
  }
  return isUpStatus(currentStatus) ? 1 : 0;
}

function computeUptime(flips, start, end, currentStatus) {
  const total = end - start;
  if (total <= 0) return 100;

  let state = stateBefore(flips, start, currentStatus);
  let cursor = start;
  let upSeconds = 0;

  for (const flip of flips) {
    if (flip.t <= start) continue;
    if (flip.t >= end) break;
    if (state === 1) upSeconds += flip.t - cursor;
    cursor = flip.t;
    state = flip.up;
  }
  if (state === 1) upSeconds += end - cursor;

  return Math.max(0, Math.min(100, (upSeconds / total) * 100));
}

function buildDailyUptime(flips, start, end, currentStatus) {
  const days = [];
  const endDay = new Date(end * 1000);
  endDay.setUTCHours(0, 0, 0, 0);

  for (let i = 29; i >= 0; i -= 1) {
    const dayStart = new Date(endDay);
    dayStart.setUTCDate(endDay.getUTCDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayStart.getUTCDate() + 1);

    let segStart = Math.floor(dayStart.getTime() / 1000);
    let segEnd = Math.floor(dayEnd.getTime() / 1000);
    if (segEnd <= start || segStart >= end) {
      days.push({
        date: dayStart.toISOString().slice(0, 10),
        uptime: null,
      });
      continue;
    }
    segStart = Math.max(segStart, start);
    segEnd = Math.min(segEnd, end);
    days.push({
      date: dayStart.toISOString().slice(0, 10),
      uptime: computeUptime(flips, segStart, segEnd, currentStatus),
    });
  }
  return days;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
