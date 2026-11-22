# Backend deployment guide

## Render free setup

The repository includes `render.yaml` for a one-instance Render Web Service.

Environment variables:

```text
NODE_VERSION=22
ENVIRONMENT=production
ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app
PORT=<provided automatically by Render>
```

Do not set `PORT` manually on Render. The platform supplies it.

Start command:

```bash
npm start
```

Health endpoint:

```text
GET /health
```

## Cloudflare Workers setup

The Worker entry point is `cloudflare-worker.mjs`. It forwards the existing Express API to one SQLite-backed Durable Object, which keeps lobby state consistent across requests and restores it after an isolate restarts.

Install dependencies and run locally:

```bash
npm install
npm run dev:worker
```

Deploy with Wrangler:

```bash
npm run deploy:worker
```

For a Cloudflare Git integration using this backend repository, leave the build command empty and use `npm run deploy:worker` as the deploy command. Set `ALLOWED_ORIGINS` in the Worker's Variables to a comma-separated allowlist containing every frontend domain, such as `https://inglisc.vercel.app,https://inglisc.it,https://www.inglisc.it`. Exact origins are supported, along with `*` matching one hostname label for Vercel previews; keep the pattern scoped to your project, for example `https://inglisc-*-fernet-ais-projects.vercel.app`. It is a plain-text variable, not a secret. Do not include a trailing slash. Native app requests without an `Origin` header remain allowed.

The Worker uses a single coordinator Durable Object because the API includes global lobby listings, active-player counts, and a shared coffee counter. This is appropriate for the current small game; higher traffic may require partitioning state by lobby and redesigning the global endpoints.

## Messaggi Scrivimi

Messages are stored in the `messages` SQL table of the SQLite-backed coordinator Durable Object. The standalone Node/Render server keeps them in memory only, so they are lost on restart. Each message contains an ID, text and creation date. Submissions are anonymous and limited to 1,000 characters; the inbox holds up to 200 messages and rejects new submissions when full, without deleting existing messages. Messages previously stored in `game-state` are not migrated to the SQL table.

To read the messages in the Cloudflare dashboard after deploying the Worker:

1. Open **Durable Objects** and select the `GameCoordinator` namespace for `inglisc-be`.
2. Select **Data Studio** and enter `global` as the Durable Object's unique name.
3. Open the `messages` table or run `SELECT id, message, createdAt FROM messages ORDER BY createdAt DESC;` in the query tab.

The table is created when the Durable Object first starts after deployment. Data Studio requires at least Editor access to the Worker. Treat the table as production data: deleting a row frees a place in the inbox and permanently removes that message.

Configure a strong secret to read and delete messages. For the Worker, create it with:

```bash
npx wrangler secret put MESSAGE_ADMIN_TOKEN
```

For standalone Node, set `MESSAGE_ADMIN_TOKEN` in the server environment. Without this secret, reading and deleting messages are disabled. Keep it out of the frontend and source control.

From a private terminal, set `MESSAGE_ADMIN_TOKEN` and replace the example URL with your backend URL:

```bash
curl -H "Authorization: Bearer $MESSAGE_ADMIN_TOKEN" https://your-backend.example/messages
```

After saving any message you want to keep, remove it by its ID to free space:

```bash
curl -X DELETE -H "Authorization: Bearer $MESSAGE_ADMIN_TOKEN" https://your-backend.example/messages/MESSAGE_ID
```

Protect the secret and downloaded messages; message submissions can contain personal information. The endpoint does not send notifications and is not rate-limited.

## CORS

Without `ALLOWED_ORIGINS`, CORS remains open for local development and native apps.

In production set a comma-separated list of exact origins:

```text
ALLOWED_ORIGINS=https://app.example.com,https://preview.example.com
```

Native Android builds do not send an `Origin` header and are not rejected by origin filtering.

## Free-tier behavior

A free Render instance may sleep after inactivity. Restarting it clears all lobby state because the game uses an in-memory `Map`. Any lobby active during restart is lost.

Keep one instance only. Multiple instances without shared storage would show different lobby state to different players.

## Pre-production requirements

Before a public launch:

1. Replace the in-memory store with Redis or PostgreSQL.
2. Add rate limiting and abuse protection.
3. Add TLS/custom domains.
4. Restrict CORS.
5. Add metrics and crash reporting.
6. Add structured audit logs without tokens or request bodies.
7. Add lobby creation and join limits.

## Local container-independent launch

```bash
npm install
PORT=3000 ENVIRONMENT=production npm start
```

Verify:

```bash
curl http://localhost:3000/health
npm test
```
