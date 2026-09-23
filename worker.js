const CHECKS = [
  { key: 'tv', uuid: '485c571d-6160-4fbe-991f-352c698fd121', label: 'tv-home-server' },
  { key: 'gaming', uuid: '1d405c80-7b74-495e-ab53-1682a0df8ab9', label: 'gaming-home-server' },
];

const WINDOW_SECONDS = 30 * 24 * 3600; // 30 days

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/uptime') {
      return handleUptime(env);
    }

    // Everything else: serve the static site files as before.
    return env.ASSETS.fetch(request);
  },
};

async function handleUptime(env) {
  if (!env.HC_API_KEY) {
    return json({ error: 'HC_API_KEY not configured' }, 500);
  }

  const now = Math.floor(Date.now() / 1000);
  const start = now - WINDOW_SECONDS;
  const headers = { 'X-Api-Key': env.HC_API_KEY };

  const results = {};

  await Promise.all(
    CHECKS.map(async (c) => {
      try {
        const [checkRes, flipsRes] = await Promise.all([
          fetch(`https://healthchecks.io/api/v3/checks/${c.uuid}`, { headers }),
          fetch(`https://healthchecks.io/api/v3/checks/${c.uuid}/flips/?start=${start}`, { headers }),
        ]);

        if (!checkRes.ok) throw new Error('check fetch failed: ' + checkRes.status);
        if (!flipsRes.ok) throw new Error('flips fetch failed: ' + flipsRes.status);

        const check = await checkRes.json();
        const flips = await flipsRes.json();

        results[c.key] = {
          label: c.label,
          status: check.status,
          last_ping: check.last_ping || null,
          uptime_30d: computeUptime(flips, start, now, check.status),
        };
      } catch (err) {
        results[c.key] = { label: c.label, status: 'unknown', last_ping: null, uptime_30d: null, debug: String(err && err.message || err) };
      }
    })
  );

  return json(results);
}

// flips: array of { timestamp, up } status transitions within [start, end].
// Walks them in order to total up how many seconds were spent "up" in the window.
function computeUptime(flips, start, end, currentStatus) {
  const total = end - start;
  if (total <= 0) return 100;

  if (!Array.isArray(flips) || flips.length === 0) {
    // No transitions recorded in the window at all — infer from current status.
    return currentStatus === 'down' ? 0 : 100;
  }

  const sorted = flips.slice().sort((a, b) => a.timestamp - b.timestamp);

  // State just before the first flip in the window is the opposite of what it flipped to.
  let state = sorted[0].up ? 0 : 1;
  let cursor = start;
  let upSeconds = 0;

  for (const flip of sorted) {
    const t = Math.min(Math.max(flip.timestamp, start), end);
    if (state === 1) upSeconds += t - cursor;
    cursor = t;
    state = flip.up ? 1 : 0;
  }
  if (state === 1) upSeconds += end - cursor;

  return Math.max(0, Math.min(100, (upSeconds / total) * 100));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
