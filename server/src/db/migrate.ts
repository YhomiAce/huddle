import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import type { Db } from "./client.js";

/** Folder holding the committed SQL migrations (`server/drizzle`), from `src/` or `dist/`. */
export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/** Arbitrary constant so every instance contends for the same advisory lock. */
const MIGRATION_LOCK_KEY = 4_811_302;

/**
 * Runs `fn` while holding a Postgres advisory lock, so several instances booting at once
 * don't run migrations or the seed concurrently.
 *
 * @param pool - The pool to borrow a dedicated connection from.
 * @param fn - Work to perform while holding the lock.
 */
export async function withStartupLock<T>(pool: pg.Pool, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    return await fn();
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/**
 * Applies pending migrations. Already-applied migrations are skipped, so this is idempotent.
 *
 * @param db - The Drizzle handle to migrate.
 */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
