import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sessions, users, type User } from "../db/schema.js";

/** Cookie that carries the session token. */
export const SESSION_COOKIE = "huddle_session";
/** Sessions last 30 days. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Creates and resolves opaque session tokens stored (hashed) in Postgres. */
export class SessionStore {
  /**
   * @param db - Database handle.
   * @param secret - `SESSION_SECRET`; tokens are stored as HMAC-SHA256 digests keyed with it.
   */
  constructor(
    private readonly db: Db,
    private readonly secret: string,
  ) {}

  private hash(token: string): string {
    return createHmac("sha256", this.secret).update(token).digest("hex");
  }

  /**
   * Starts a session for a user.
   *
   * @returns The raw token to put in the cookie, and its expiry.
   */
  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(sessions).values({ tokenHash: this.hash(token), userId, expiresAt });
    // Opportunistic cleanup keeps the table small without a cron job.
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    return { token, expiresAt };
  }

  /** Returns the user behind a token, or null when it is unknown or expired. */
  async resolve(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const [row] = await this.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, this.hash(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return row?.user ?? null;
  }

  /** Ends a session. Unknown tokens are ignored. */
  async destroy(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db.delete(sessions).where(eq(sessions.tokenHash, this.hash(token)));
  }
}
