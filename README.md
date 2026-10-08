# landonprojects

Source for [landonprojects.com](https://landonprojects.com) — a small personal site and status page.

## Stack

- Plain HTML/CSS/JS, no build step, no framework
- Deployed on [Cloudflare Workers](https://developers.cloudflare.com/workers/) with static assets
- A small Worker script (`worker.js`) serves the static files and dynamic routes (`/api/uptime`, `/api/synapse-status`)
- Live status pulled from [Healthchecks.io](https://healthchecks.io)

## Structure

```
index.html      Landing page
uptime.html     Live status / 30-day uptime for the homelab
404.html        Custom not-found page
worker.js       Serves static assets + API routes
wrangler.toml   Cloudflare Worker config
robots.txt
sitemap.xml
```

## `/api/uptime`

Calls the Healthchecks.io Management API server-side (so the API key never
reaches the browser) and computes a 30-day uptime percentage from each
check's status-change history. Served on `landonprojects.com`.

## `/api/synapse-status`

Served on `synapse.landonprojects.com`. Powers the homepage status strip and
`/status` page: `{ status, lastPing, checkedAt, uptime30d }` where `status` is
`up` | `down` | `unknown`. Missing secrets return `unknown` with HTTP 200.
The public status page is `https://synapse.landonprojects.com/status`.

Requires secrets in the Cloudflare dashboard under
**Workers & Pages > landonprojects > Settings > Variables and Secrets**:

| Name | Value |
|---|---|
| `HC_API_KEY` | A **read-only** Healthchecks.io API key (shared by both routes) |
| `SYNAPSE_HC_UUID` | UUID of the Synapse bot Healthchecks.io check (`HC_SYNAPSE_UUID` also accepted) |

## Deploy

Pushes to `main` auto-deploy via Cloudflare's Git integration
(`npx wrangler deploy`, configured in the Cloudflare dashboard).
