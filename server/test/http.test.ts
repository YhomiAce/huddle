import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import { startHuddle, type RunningHuddle } from "../src/server.js";
import { TEST_DATABASE_URL, TEST_REDIS_PREFIX, TEST_REDIS_URL } from "./env.js";
import { openTestDb, resetDb } from "./helpers.js";

describe("HTTP API", () => {
  let database: Database;
  let huddle: RunningHuddle;

  beforeAll(async () => {
    database = openTestDb();
    await resetDb(database);
    huddle = await startHuddle(
      loadConfig({
        NODE_ENV: "test",
        PORT: "0",
        HOST: "127.0.0.1",
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: TEST_REDIS_URL,
        SESSION_SECRET: "test-session-secret-0123456789",
        REDIS_PREFIX: `${TEST_REDIS_PREFIX}-http`,
        TRUST_PROXY: "true",
      }),
      { prepareDatabase: false },
    );
  });

  afterAll(async () => {
    await huddle?.close();
    await database?.pool.end();
  });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${huddle.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("reports health of Postgres and Redis", async () => {
    const res = await fetch(`${huddle.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", postgres: "ok", redis: "ok" });
  });

  it("returns clean JSON errors", async () => {
    const unauth = await fetch(`${huddle.url}/api/channels`);
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ error: { code: "unauthorized", message: "Please sign in." } });

    const invalid = await post("/api/auth/signup", { email: "nope", password: "x", displayName: "" });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe("bad_request");

    const malformed = await fetch(`${huddle.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain("at ");
  });

  it("marks the session cookie Secure only behind https (X-Forwarded-Proto)", async () => {
    const signup = await post("/api/auth/signup", {
      email: "hopper@test.huddle.dev",
      password: "correct horse battery",
      displayName: "Grace",
    });
    expect(signup.status).toBe(201);
    const plainCookie = signup.headers.get("set-cookie") ?? "";
    expect(plainCookie).toMatch(/HttpOnly/);
    expect(plainCookie).not.toMatch(/Secure/);

    const login = await post(
      "/api/auth/login",
      { email: "HOPPER@test.huddle.dev", password: "correct horse battery" },
      { "x-forwarded-proto": "https" },
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/Secure/);

    const me = await fetch(`${huddle.url}/api/auth/me`, { headers: { cookie: cookie.split(";")[0] ?? "" } });
    expect(((await me.json()) as { user: { displayName: string } }).user.displayName).toBe("Grace");

    const wrong = await post("/api/auth/login", { email: "hopper@test.huddle.dev", password: "wrong password" });
    expect(wrong.status).toBe(401);
  });
});
