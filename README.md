# landonprojects

Source for [landonprojects.com](https://landonprojects.com) — a small personal site and status page.

## Stack

- Plain HTML/CSS/JS, no build step, no framework
- Deployed on [Cloudflare Workers](https://developers.cloudflare.com/workers/) with static assets
- A small Worker script (`worker.js`) serves the static files and adds one dynamic route, `/api/uptime`
- Live status pulled from [Healthchecks.io](https://healthchecks.io)

## Structure

```
index.html      Landing page
uptime.html     Live status / 30-day uptime for the homelab
404.html        Custom not-found page
worker.js       Serves static assets + /api/uptime
wrangler.toml   Cloudflare Worker config
robots.txt
sitemap.xml
```

## `/api/uptime`

Calls the Healthchecks.io Management API server-side (so the API key never
reaches the browser) and computes a 30-day uptime percentage from each
check's status-change history.

Requires one secret, set in the Cloudflare dashboard under
**Workers & Pages > landonprojects > Settings > Variables and Secrets**:

| Name | Value |
|---|---|
| `HC_API_KEY` | A **read-only** Healthchecks.io API key |

## Deploy

Pushes to `main` auto-deploy via Cloudflare's Git integration
(`npx wrangler deploy`, configured in the Cloudflare dashboard).
