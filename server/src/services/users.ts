import { asc, eq, sql } from "drizzle-orm";
import argon2 from "argon2";
import type { Db } from "../db/client.js";
import { users, type User } from "../db/schema.js";
import { AppError, notFound } from "../lib/errors.js";

/** Avatar colours offered in the profile editor. */
export const AVATAR_COLORS = [
  "#e11d48",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0d9488",
  "#0284c7",
  "#4f46e5",
  "#9333ea",
  "#c026d3",
  "#475569",
] as const;

/** The public view of a user; never includes the password hash or email of others. */
export interface PublicUser {
  id: string;
  displayName: string;
  avatarColor: string;
}

/** The signed-in user's own profile. */
export interface SelfUser extends PublicUser {
  email: string;
}

/** Projects a user row to its public view. */
export function toPublicUser(user: Pick<User, "id" | "displayName" | "avatarColor">): PublicUser {
  return { id: user.id, displayName: user.displayName, avatarColor: user.avatarColor };
}

/** Projects a user row to the signed-in user's own view. */
export function toSelfUser(user: User): SelfUser {
  return { ...toPublicUser(user), email: user.email };
}

/** Picks a stable avatar colour from an email address. */
export function defaultAvatarColor(email: string): string {
  let hash = 0;
  for (const ch of email.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/**
 * Creates an account with an argon2id password hash.
 *
 * @throws AppError(409) when the email is already registered.
 */
export async function createUser(
  db: Db,
  input: { email: string; password: string; displayName: string; avatarColor?: string },
): Promise<User> {
  const existing = await findUserByEmail(db, input.email);
  if (existing) throw new AppError(409, "email_taken", "An account with that email already exists.");
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const [user] = await db
    .insert(users)
    .values({
      email: input.email.trim().toLowerCase(),
      passwordHash,
      displayName: input.displayName.trim(),
      avatarColor: input.avatarColor ?? defaultAvatarColor(input.email),
    })
    .returning();
  if (!user) throw new Error("Insert returned no row");
  return user;
}

/** Finds a user by email, case-insensitively. */
export async function findUserByEmail(db: Db, email: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
    .limit(1);
  return user;
}

/**
 * Checks an email + password pair.
 *
 * @returns The user, or `null` when the credentials don't match.
 */
export async function verifyCredentials(db: Db, email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(db, email);
  if (!user) return null;
  return (await argon2.verify(user.passwordHash, password)) ? user : null;
}

/** Lists every user in the workspace, alphabetically. */
export async function listUsers(db: Db): Promise<PublicUser[]> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarColor: users.avatarColor })
    .from(users)
    .orderBy(asc(users.displayName));
  return rows;
}

/**
 * Updates the display name and/or avatar colour of a user.
 *
 * @throws AppError(404) when the user doesn't exist.
 */
export async function updateProfile(
  db: Db,
  userId: string,
  patch: { displayName?: string; avatarColor?: string },
): Promise<User> {
  const [user] = await db
    .update(users)
    .set({
      ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() } : {}),
      ...(patch.avatarColor !== undefined ? { avatarColor: patch.avatarColor } : {}),
    })
    .where(eq(users.id, userId))
    .returning();
  if (!user) throw notFound("User");
  return user;
}
