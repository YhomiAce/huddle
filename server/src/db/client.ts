import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

/** Drizzle database handle with the Huddle schema attached. */
export type Db = NodePgDatabase<typeof schema>;

/** A database handle plus the pool behind it, so callers can close it. */
export interface Database {
  db: Db;
  pool: pg.Pool;
}

/**
 * Opens a connection pool and wraps it in Drizzle.
 *
 * @param connectionString - A `postgres://` URL.
 */
export function createDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000 });
  pool.on("error", (err) => console.error("Postgres pool error:", err.message));
  return { db: drizzle(pool, { schema }), pool };
}
