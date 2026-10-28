import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import type pg from "pg";
import type { Redis } from "ioredis";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { AppError, toErrorResponse } from "./lib/errors.js";
import type { PresenceStore } from "./realtime/presence.js";
import type { HuddleServer } from "./realtime/socket.js";
import type { SessionStore } from "./services/sessions.js";
import { loadSession } from "./http/session.js";
import { authRouter } from "./http/routes/auth.js";
import { channelsRouter } from "./http/routes/channels.js";
import { directoryRouter } from "./http/routes/directory.js";
import { healthRouter } from "./http/routes/health.js";

/** Built client (`client/dist`), resolved from `server/src` or `server/dist`. */
export const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");

/** Demo accounts created by the seed; shown on the login page when `DEMO_MODE=true`. */
export const DEMO_CREDENTIALS = {
  emails: ["ada@huddle.dev", "linus@huddle.dev", "grace@huddle.dev"],
  password: "huddle-demo-123",
};

/** Everything the HTTP layer needs. */
export interface AppDeps {
  config: Config;
  db: Db;
  pool: pg.Pool;
  redis: Redis;
  sessions: SessionStore;
  presence: PresenceStore;
  io: HuddleServer;
}

/**
 * Builds the Express application: JSON API under `/api`, health checks, and the built
 * React client with an SPA fallback.
 *
 * @param deps - Shared services.
 */
export function createApp(deps: AppDeps): express.Express {
  const { config } = deps;
  const app = express();

  // Behind Traefik/nginx, X-Forwarded-Proto tells us the browser used https, which
  // makes req.secure true and lets the session cookie be marked Secure.
  app.set("trust proxy", config.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(healthRouter({ pool: deps.pool, redis: deps.redis }));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          // Plain-http self-hosting (LAN, localhost) must keep working.
          "upgrade-insecure-requests": null,
        },
      },
      // Only meaningful over https; harmless otherwise, but don't pin plain-http hosts.
      strictTransportSecurity: false,
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.get("/config", (_req, res) => {
    res.json({ demoMode: config.DEMO_MODE, demoCredentials: config.DEMO_MODE ? DEMO_CREDENTIALS : null });
  });
  api.use(loadSession(deps.sessions));
  api.use("/auth", authRouter(deps));
  api.use(channelsRouter(deps));
  api.use(directoryRouter(deps));
  api.use(() => {
    throw new AppError(404, "not_found", "No such endpoint.");
  });
  app.use("/api", api);

  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: "1h" }));
    app.use("/assets", (_req, res) => {
      res.status(404).json({ error: { code: "not_found", message: "Asset not found." } });
    });
    app.get("/{*splat}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(CLIENT_DIST, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res.type("text").send("Huddle API is running. Build the client (npm run build) or use the Vite dev server.");
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found." } });
  });

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    // Body-parser errors carry a status (400 bad JSON, 413 too large).
    const parserStatus = !(err instanceof AppError) && err instanceof Error && "status" in err ? err.status : undefined;
    if (typeof parserStatus === "number" && parserStatus >= 400 && parserStatus < 500) {
      const message = parserStatus === 413 ? "Request body is too large." : "Malformed request body.";
      res.status(parserStatus).json({ error: { code: "bad_request", message } });
      return;
    }
    const { status, body } = toErrorResponse(err);
    res.status(status).json(body);
  };
  app.use(onError);

  return app;
}
