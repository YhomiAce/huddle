import { Router, type RequestHandler } from "express";
import type pg from "pg";
import type { Redis } from "ioredis";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function check(fn: () => Promise<unknown>): Promise<"ok" | "error"> {
  try {
    await withTimeout(fn(), 2_000);
    return "ok";
  } catch {
    return "error";
  }
}

/**
 * `GET /health` and `GET /api/health`: 200 when Postgres and Redis answer, 503 otherwise.
 *
 * @param deps - The Postgres pool and a Redis client to ping.
 */
export function healthRouter(deps: { pool: pg.Pool; redis: Redis }): Router {
  const router = Router();
  const handler: RequestHandler = async (_req, res) => {
    const [postgres, redis] = await Promise.all([
      check(() => deps.pool.query("select 1")),
      check(() => deps.redis.ping()),
    ]);
    const ok = postgres === "ok" && redis === "ok";
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", postgres, redis });
  };
  router.get(["/health", "/api/health"], handler);
  return router;
}
