/** Test database; created automatically if missing. Never points at the dev database. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:fleetdev@127.0.0.1:55432/huddle_test";
/** Test Redis (same index as dev, isolated by key prefix). */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379/4";
export const TEST_REDIS_PREFIX = "huddle-test";
