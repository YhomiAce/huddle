import type { Redis } from "ioredis";

/** What other people see next to your name. */
export type PresenceStatus = "online" | "away" | "offline";

/** A socket's entry expires unless the client heartbeats within this window. */
export const PRESENCE_TTL_MS = 60_000;

/**
 * Presence kept in Redis so every instance agrees on who is online.
 *
 * Each user has a hash of `socketId -> "status:expiresAtMs"`. A user is online if any live
 * socket says online, away if every live socket says away, and offline otherwise. The key
 * itself has a TTL, so a crashed instance can't leave someone "online" forever.
 */
export class PresenceStore {
  /**
   * @param redis - Redis client for commands.
   * @param prefix - Key prefix (`REDIS_PREFIX`).
   */
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  private key(userId: string): string {
    return `${this.prefix}:presence:${userId}`;
  }

  /** Records (or refreshes) one socket's status and returns the user's overall status. */
  async touch(userId: string, socketId: string, status: Exclude<PresenceStatus, "offline">): Promise<PresenceStatus> {
    const key = this.key(userId);
    await this.redis
      .multi()
      .hset(key, socketId, `${status}:${Date.now() + PRESENCE_TTL_MS}`)
      .pexpire(key, PRESENCE_TTL_MS * 2)
      .exec();
    return this.statusOf(userId);
  }

  /** Forgets a socket and returns the user's overall status. */
  async remove(userId: string, socketId: string): Promise<PresenceStatus> {
    await this.redis.hdel(this.key(userId), socketId);
    return this.statusOf(userId);
  }

  /** Overall status of one user. */
  async statusOf(userId: string): Promise<PresenceStatus> {
    const statuses = await this.statusOfMany([userId]);
    return statuses[userId] ?? "offline";
  }

  /** Overall status of several users, in one round trip. */
  async statusOfMany(userIds: string[]): Promise<Record<string, PresenceStatus>> {
    const result: Record<string, PresenceStatus> = {};
    if (userIds.length === 0) return result;
    const pipeline = this.redis.pipeline();
    for (const id of userIds) pipeline.hgetall(this.key(id));
    const replies = (await pipeline.exec()) ?? [];
    const now = Date.now();
    userIds.forEach((id, index) => {
      const [err, value] = replies[index] ?? [null, {}];
      const entries = err ? {} : ((value ?? {}) as Record<string, string>);
      result[id] = summarize(Object.values(entries), now);
    });
    return result;
  }
}

/**
 * Collapses per-socket entries into one status.
 *
 * @param entries - Raw `"status:expiresAtMs"` values.
 * @param now - Current time in ms.
 */
export function summarize(entries: string[], now: number): PresenceStatus {
  let away = false;
  for (const entry of entries) {
    const [status, expires] = entry.split(":");
    if (Number(expires) < now) continue;
    if (status === "online") return "online";
    if (status === "away") away = true;
  }
  return away ? "away" : "offline";
}
