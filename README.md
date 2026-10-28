# Huddle

Real-time team chat you can host yourself: a small Slack alternative built with Express 5, Socket.IO, Postgres, Redis and React 19.

## Features

- **Accounts:** sign up and sign in with email and password (argon2id hashes). Sessions use an httpOnly cookie. Each user has a display name and an avatar colour.
- **Workspace and channels:** one workspace per deployment. You can create, join and leave public channels and set their topics. Direct messages work between any two users.
- **Real-time messaging over Socket.IO:** WebSocket first, with long-polling as a fallback. You can send, edit and delete your own messages and add emoji reactions.
- **Markdown-lite:** `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[links](https://…)` and bare URLs. It is rendered server-side and sanitized: the HTML is escaped first, and only http, https and mailto links are allowed.
- **Live status:**
  - typing indicators
  - presence (online, away when the tab is hidden or idle for 5 minutes, offline)
  - unread counts per channel
- **History:** cursor-paginated history (infinite scroll up) and Postgres full-text search across the channels you're in. Search supports `"phrases"`, `or` and `-exclusions`.
- **Multi-instance ready:** the Socket.IO Redis adapter fans events out to every instance. Presence lives in Redis with TTLs, and startup migrations take a Postgres advisory lock, so several replicas can boot at once.
- **Demo data:** on first start (empty database) Huddle creates `#general`, `#random`, `#engineering`, a DM and about 60 messages from three demo users.

| Demo account       | Password          |
| ------------------ | ----------------- |
| `ada@huddle.dev`   | `huddle-demo-123` |
| `linus@huddle.dev` | `huddle-demo-123` |
| `grace@huddle.dev` | `huddle-demo-123` |

With `DEMO_MODE=true` the login page shows these accounts.

## Project layout

```
server/   Express 5 + Socket.IO + Drizzle (Postgres) + ioredis + zod
  src/        app, realtime (socket handlers, presence), services, db (schema, migrate, seed)
  drizzle/    committed SQL migrations
  test/       vitest suites (run against a local Postgres + Redis)
client/   React 19 + Vite. It is built to static files that the Express server serves (same origin)
```

npm workspaces, one root `package-lock.json`.

## Local development

You need Node 22+, Postgres and Redis.

```bash
npm install
cp .env.example .env        # adjust DATABASE_URL / REDIS_URL if needed
npm run dev                 # API + Socket.IO on :5113, Vite on :5114
```

Open http://localhost:5114. Vite proxies `/api` and `/socket.io` (including WebSocket upgrades) to the server on 5113. In development the server falls back to `postgresql://postgres:fleetdev@127.0.0.1:55432/huddle`, `redis://127.0.0.1:56379/4` and a dev session secret when those variables aren't set.

Other scripts:

```bash
npm test             # server tests (needs Postgres + Redis, see below)
npm run build        # client (vite build) then server (tsc)
npm start            # production server: migrates, seeds if empty, serves client + API
npm run typecheck
npm run db:generate -w server   # generate a migration after changing server/src/db/schema.ts
```

### Tests

`npm test` runs these vitest suites:

- the markdown sanitizer
- presence logic
- message permissions (edit and delete your own messages only, channel and DM membership, search scoping)
- cursor pagination
- HTTP errors and cookies
- a Socket.IO integration test: two clients, plus two server instances sharing the Redis adapter

The suites run against:

- `TEST_DATABASE_URL`, default `postgresql://postgres:fleetdev@127.0.0.1:55432/huddle_test`. The tests create this database if it's missing and truncate its tables.
- `TEST_REDIS_URL`, default `redis://127.0.0.1:56379/4`. Test keys use their own prefix.

### Docker Compose (local)

```bash
docker compose up --build
```

This starts the app on http://localhost:3000 with its own Postgres (named volume `pgdata`) and Redis. The app waits for both healthchecks before it starts. Compose is only for local use: **production builds the `Dockerfile`** and points it at managed Postgres and Redis.

## Environment variables

| Name             | Required                 | Example                                  | Build or runtime | Notes                                                                                     |
| ---------------- | ------------------------ | ---------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | yes (production)         | `postgresql://user:pass@host:5432/huddle` | runtime          | Postgres 13+.                                                                             |
| `REDIS_URL`      | yes (production)         | `redis://host:6379/0`                    | runtime          | Used for the Socket.IO adapter (pub and sub connections) and presence.                     |
| `SESSION_SECRET` | yes (production)         | `openssl rand -hex 32`                   | runtime          | At least 16 characters. Session tokens are stored as HMACs keyed with it.                 |
| `PORT`           | no (default `3000`)      | `3000`                                   | runtime          | Listens on `0.0.0.0`. Development defaults to `5113`.                                     |
| `DEMO_MODE`      | no (default `false`)     | `true`                                   | runtime          | Shows the demo credentials on the login page.                                             |
| `TRUST_PROXY`    | no (default `true`)      | `true`                                   | runtime          | Trust `X-Forwarded-*` from the reverse proxy. Needed for `Secure` cookies behind TLS.     |
| `REDIS_PREFIX`   | no (default `huddle`)    | `huddle-staging`                         | runtime          | Key and channel prefix, so you can share one Redis between deployments.                   |

No variables are needed at build time.

## Deploying

The repo ships a production `Dockerfile`. It is a multi-stage build that ends on a slim runtime: `node:22-alpine`, production dependencies only, a non-root `node` user and a `HEALTHCHECK`.

```bash
docker build -t huddle .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://… -e REDIS_URL=redis://… -e SESSION_SECRET=… huddle
```

Without Docker:

| Step    | Command                              |
| ------- | ------------------------------------ |
| Install | `npm ci`                             |
| Build   | `npm run build`                      |
| Start   | `npm start` (`node server/dist/index.js`) |
| Port    | `PORT`, default `3000`               |
| Health  | `GET /health` (also `/api/health`); 200 when Postgres and Redis respond, else 503 |

- **Build-time env vars:** none.
- **Runtime env vars:** `DATABASE_URL`, `REDIS_URL` and `SESSION_SECRET` (required), plus `DEMO_MODE` and `TRUST_PROXY` (optional).
- **Migrations:** these run automatically on start, before the server listens. They are idempotent and guarded by a Postgres advisory lock. The demo seed runs only when the `users` table is empty.
- **Static files:** the server serves the built client from `client/dist`, so the whole app is one service on one origin.

### Behind a reverse proxy (Traefik, nginx, Caddy)

- **WebSockets must pass through the proxy.**
  - Socket.IO uses `/socket.io/` with an HTTP `Upgrade`.
  - Traefik forwards upgrades by default.
  - nginx needs `proxy_http_version 1.1`, `proxy_set_header Upgrade $http_upgrade` and `proxy_set_header Connection "upgrade"`, and a `proxy_read_timeout` longer than the 25 s ping interval.
  - If upgrades are blocked, clients fall back to long-polling. That still works with one instance. With several instances it needs **sticky sessions**, because a polling session has to keep hitting the same instance. WebSocket-only traffic doesn't need stickiness.
- **TLS termination:** keep `TRUST_PROXY=true`. The proxy sets `X-Forwarded-Proto: https`, Express then sees the request as secure, and the session cookie gets the `Secure` flag. With `TRUST_PROXY=false` behind TLS, cookies are sent without `Secure`.
- **Same-origin check:** Socket.IO handshakes are accepted only when the browser's `Origin` matches the `Host` (or `X-Forwarded-Host`) header. Traefik preserves `Host` by default. If your proxy rewrites it, forward the original host.
- **Scaling out:** run as many replicas as you like against the same Postgres and Redis. Messages, typing and presence reach clients on every instance.

## License

MIT
