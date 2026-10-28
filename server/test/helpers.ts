import { sql } from "drizzle-orm";
import { createDatabase, type Database } from "../src/db/client.js";
import { createUser } from "../src/services/users.js";
import type { User } from "../src/db/schema.js";
import { TEST_DATABASE_URL } from "./env.js";

/** Opens a connection to the test database. */
export function openTestDb(): Database {
  return createDatabase(TEST_DATABASE_URL);
}

/** Empties every table so each suite starts clean. */
export async function resetDb({ db }: Database): Promise<void> {
  await db.execute(
    sql`truncate table reactions, messages, channel_members, channels, sessions, workspaces, users restart identity cascade`,
  );
}

let counter = 0;

/** Creates a user with a unique email. */
export async function makeUser(database: Database, name: string): Promise<User> {
  counter += 1;
  return createUser(database.db, {
    email: `${name.toLowerCase()}-${counter}-${Date.now()}@test.huddle.dev`,
    password: "correct horse battery",
    displayName: name,
  });
}
