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
