import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { channelMembers, channels, messages, users, workspaces, type Channel } from "../db/schema.js";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors.js";

/** A channel as listed in the sidebar for one user. */
export interface ChannelSummary {
  id: string;
  kind: "public" | "dm";
  name: string | null;
  topic: string;
  joined: boolean;
  memberCount: number;
  unread: number;
  /** For DMs: the other participant. */
  dmUserId: string | null;
}

/**
 * Normalises a channel name the way Slack does: lowercase, dashes for spaces.
 *
 * @throws AppError(400) when nothing valid is left.
 */
export function normalizeChannelName(raw: string): string {
  const name = raw
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
  if (!name) throw badRequest("Channel names can use letters, numbers, dashes and underscores.");
  return name;
}

/** Returns the deployment's workspace, creating it on first use. */
export async function getWorkspace(db: Db): Promise<{ id: string; name: string }> {
  const [existing] = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(workspaces).values({ name: "Huddle" }).returning();
  if (!created) throw new Error("Insert returned no row");
  return created;
}

/** Lists public channels (joined or not) and the user's DMs, with unread counts. */
export async function listChannelsForUser(db: Db, userId: string): Promise<ChannelSummary[]> {
  const result = await db.execute<{
    id: string;
    kind: "public" | "dm";
    name: string | null;
    topic: string;
    joined: boolean;
    member_count: string;
    unread: string;
    dm_user_id: string | null;
  }>(sql`
    select c.id, c.kind, c.name, c.topic,
      (m.user_id is not null) as joined,
      (select count(*) from ${channelMembers} cm where cm.channel_id = c.id) as member_count,
      case when m.user_id is null then 0 else (
        select count(*) from ${messages} msg
        where msg.channel_id = c.id and msg.id > m.last_read_message_id and msg.user_id <> ${userId}
      ) end as unread,
      case when c.kind = 'dm' then (
        select cm.user_id from ${channelMembers} cm where cm.channel_id = c.id and cm.user_id <> ${userId} limit 1
      ) end as dm_user_id
    from ${channels} c
    left join ${channelMembers} m on m.channel_id = c.id and m.user_id = ${userId}
    where c.kind = 'public' or m.user_id is not null
    order by c.kind desc, c.name asc, c.created_at asc
  `);
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    topic: row.topic,
    joined: row.joined,
    memberCount: Number(row.member_count),
    unread: Number(row.unread),
    dmUserId: row.dm_user_id,
  }));
}

/**
 * Loads a channel and checks that the user is a member.
 *
 * @throws AppError(404) when the channel doesn't exist, (403) when the user isn't a member.
 */
export async function assertMember(db: Db, userId: string, channelId: string): Promise<Channel> {
  const [row] = await db
    .select({ channel: channels, memberId: channelMembers.userId })
    .from(channels)
    .leftJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, userId)))
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!row) throw notFound("Channel");
  if (!row.memberId) throw forbidden("Join this channel first.");
  return row.channel;
}

async function loadChannel(db: Db, channelId: string): Promise<Channel> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) throw notFound("Channel");
  return channel;
}

async function latestMessageId(db: Db, channelId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<string | null>`max(${messages.id})` })
    .from(messages)
    .where(eq(messages.channelId, channelId));
  return Number(row?.max ?? 0);
}

/**
 * Creates a public channel; the creator joins it.
 *
 * @throws AppError(409) when the name is taken.
 */
export async function createChannel(
  db: Db,
  userId: string,
  input: { name: string; topic?: string },
): Promise<Channel> {
  const workspace = await getWorkspace(db);
  const name = normalizeChannelName(input.name);
  const [channel] = await db
    .insert(channels)
    .values({ workspaceId: workspace.id, kind: "public", name, topic: input.topic?.trim() ?? "", createdBy: userId })
    .onConflictDoNothing()
    .returning();
  if (!channel) throw new AppError(409, "channel_exists", `#${name} already exists.`);
  await db.insert(channelMembers).values({ channelId: channel.id, userId });
  return channel;
}

/**
 * Joins a public channel. Existing history counts as read. Joining twice is a no-op.
 *
 * @throws AppError(403) for DMs.
 */
export async function joinChannel(db: Db, userId: string, channelId: string): Promise<Channel> {
  const channel = await loadChannel(db, channelId);
  if (channel.kind !== "public") throw forbidden("You can't join a direct message.");
  const lastReadMessageId = await latestMessageId(db, channelId);
  await db.insert(channelMembers).values({ channelId, userId, lastReadMessageId }).onConflictDoNothing();
  return channel;
}

/**
 * Leaves a public channel.
 *
 * @throws AppError(403) for DMs.
 */
export async function leaveChannel(db: Db, userId: string, channelId: string): Promise<Channel> {
  const channel = await loadChannel(db, channelId);
  if (channel.kind !== "public") throw forbidden("You can't leave a direct message.");
  await db
    .delete(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
  return channel;
}

/**
 * Sets a channel's topic. Any member may change it.
 *
 * @throws AppError(403) when the user isn't a member.
 */
export async function setTopic(db: Db, userId: string, channelId: string, topic: string): Promise<Channel> {
  await assertMember(db, userId, channelId);
  const [channel] = await db
    .update(channels)
    .set({ topic: topic.trim() })
    .where(eq(channels.id, channelId))
    .returning();
  if (!channel) throw notFound("Channel");
  return channel;
}

/**
 * Opens (or reuses) the direct message between two users.
 *
 * @throws AppError(400) for a DM with yourself, (404) when the other user doesn't exist.
 */
export async function openDirectMessage(db: Db, userId: string, otherUserId: string): Promise<Channel> {
  if (userId === otherUserId) throw badRequest("Pick someone other than yourself.");
  const [other] = await db.select({ id: users.id }).from(users).where(eq(users.id, otherUserId)).limit(1);
  if (!other) throw notFound("User");
  const workspace = await getWorkspace(db);
  const dmKey = [userId, otherUserId].sort().join(":");
  return db.transaction(async (tx) => {
    await tx.insert(channels).values({ workspaceId: workspace.id, kind: "dm", dmKey, createdBy: userId }).onConflictDoNothing();
    const [channel] = await tx.select().from(channels).where(eq(channels.dmKey, dmKey)).limit(1);
    if (!channel) throw new Error("DM channel missing after upsert");
    await tx
      .insert(channelMembers)
      .values([
        { channelId: channel.id, userId },
        { channelId: channel.id, userId: otherUserId },
      ])
      .onConflictDoNothing();
    return channel;
  });
}

/** Ids of every member of a channel. */
export async function channelMemberIds(db: Db, channelId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId));
  return rows.map((row) => row.userId);
}

/** Ids of every channel a user belongs to. */
export async function channelIdsForUser(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, userId));
  return rows.map((row) => row.channelId);
}
