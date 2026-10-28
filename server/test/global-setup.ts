import pg from "pg";
import { createDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { TEST_DATABASE_URL } from "./env.js";

/** Creates the test database if needed and applies migrations once per run. */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/i.test(dbName)) throw new Error(`Unsafe test database name: ${dbName}`);
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) await admin.query(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  await runMigrations(db);
  await pool.end();
}
