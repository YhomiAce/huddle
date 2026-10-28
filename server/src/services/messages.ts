import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { channelMembers, channels, messages, reactions, users } from "../db/schema.js";
import { decodeCursor, encodeCursor } from "../lib/cursor.js";
import { forbidden, notFound } from "../lib/errors.js";
import { renderMarkdownLite } from "../lib/markdown.js";
import { assertMember } from "./channels.js";
import type { PublicUser } from "./users.js";

/** Default and maximum page sizes for history. */
export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

/** A reaction aggregated per emoji. */
export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

/** A message as sent to clients. */
export interface MessageDto {
  id: number;
  channelId: string;
  author: PublicUser;
  body: string;
  /** Sanitized HTML rendered from `body`. */
  html: string;
  createdAt: string;
  editedAt: string | null;
  reactions: ReactionSummary[];
}

/** One page of history, oldest first. `nextCursor` loads older messages; null at the start. */
export interface MessagePage {
  messages: MessageDto[];
  nextCursor: string | null;
}

/** A search hit: the message plus where it was posted. */
export interface SearchHit extends MessageDto {
  channelName: string | null;
  channelKind: "public" | "dm";
}

const messageColumns = {
  id: messages.id,
  channelId: messages.channelId,
  body: messages.body,
  createdAt: messages.createdAt,
  editedAt: messages.editedAt,
  authorId: users.id,
  authorName: users.displayName,
  authorColor: users.avatarColor,
};

type MessageRow = {
  id: number;
  channelId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  authorId: string;
  authorName: string;
  authorColor: string;
};

async function reactionsFor(db: Db, messageIds: number[]): Promise<Map<number, ReactionSummary[]>> {
  const byMessage = new Map<number, ReactionSummary[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await db
    .select({ messageId: reactions.messageId, emoji: reactions.emoji, userId: reactions.userId })
    .from(reactions)
    .where(inArray(reactions.messageId, messageIds))
    .orderBy(reactions.createdAt);
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    let summary = list.find((r) => r.emoji === row.emoji);
    if (!summary) {
      summary = { emoji: row.emoji, count: 0, userIds: [] };
      list.push(summary);
    }
    summary.count += 1;
    summary.userIds.push(row.userId);
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

async function hydrate(db: Db, rows: MessageRow[]): Promise<MessageDto[]> {
  const reactionMap = await reactionsFor(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    channelId: row.channelId,
    author: { id: row.authorId, displayName: row.authorName, avatarColor: row.authorColor },
    body: row.body,
    html: renderMarkdownLite(row.body),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    reactions: reactionMap.get(row.id) ?? [],
  }));
}

async function loadMessage(db: Db, messageId: number): Promise<MessageDto> {
  const rows = await db
    .select(messageColumns)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.userId))
    .where(eq(messages.id, messageId))
    .limit(1);
  const [dto] = await hydrate(db, rows);
  if (!dto) throw notFound("Message");
  return dto;
}

/**
 * Loads a page of channel history, newest page first, using an id-based cursor so new
 * messages arriving while you scroll never shift or duplicate a page.
 *
 * @throws AppError(403) when the user isn't a member, (400) for a malformed cursor.
 */
export async function listMessages(
  db: Db,
  userId: string,
  channelId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<MessagePage> {
  await assertMember(db, userId, channelId);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const before = options.cursor ? decodeCursor(options.cursor).before : undefined;
  const rows = await db
    .select(messageColumns)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.userId))
    .where(and(eq(messages.channelId, channelId), before ? lt(messages.id, before) : undefined))
    .orderBy(desc(messages.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const oldest = page.at(-1);
  return {
    messages: await hydrate(db, page.reverse()),
    nextCursor: hasMore && oldest ? encodeCursor({ before: oldest.id }) : null,
  };
}

/**
 * Posts a message. The sender's read marker moves past it.
 *
 * @throws AppError(403) when the user isn't a member of the channel.
 */
export async function sendMessage(db: Db, userId: string, channelId: string, body: string): Promise<MessageDto> {
  await assertMember(db, userId, channelId);
  const [inserted] = await db.insert(messages).values({ channelId, userId, body }).returning({ id: messages.id });
  if (!inserted) throw new Error("Insert returned no row");
  await markRead(db, userId, channelId, inserted.id);
  return loadMessage(db, inserted.id);
}

async function loadOwnMessage(db: Db, userId: string, messageId: number) {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) throw notFound("Message");
  await assertMember(db, userId, message.channelId);
  if (message.userId !== userId) throw forbidden("You can only change your own messages.");
  return message;
}

/**
 * Edits one of the user's own messages.
 *
 * @throws AppError(403) when the message belongs to someone else or the user left the channel.
 */
export async function editMessage(db: Db, userId: string, messageId: number, body: string): Promise<MessageDto> {
  await loadOwnMessage(db, userId, messageId);
  await db.update(messages).set({ body, editedAt: new Date() }).where(eq(messages.id, messageId));
  return loadMessage(db, messageId);
}

/**
 * Deletes one of the user's own messages (and its reactions).
 *
 * @returns The id and channel of the deleted message, for broadcasting.
 * @throws AppError(403) when the message belongs to someone else.
 */
export async function deleteMessage(
  db: Db,
  userId: string,
  messageId: number,
): Promise<{ id: number; channelId: string }> {
  const message = await loadOwnMessage(db, userId, messageId);
  await db.delete(messages).where(eq(messages.id, messageId));
  return { id: message.id, channelId: message.channelId };
}

/**
 * Adds the reaction if the user hasn't reacted with that emoji yet, otherwise removes it.
 *
 * @returns The message's channel and its updated reactions.
 * @throws AppError(403) when the user isn't a member of the message's channel.
 */
export async function toggleReaction(
  db: Db,
  userId: string,
  messageId: number,
  emoji: string,
): Promise<{ messageId: number; channelId: string; reactions: ReactionSummary[] }> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) throw notFound("Message");
  await assertMember(db, userId, message.channelId);
  const removed = await db
    .delete(reactions)
    .where(and(eq(reactions.messageId, messageId), eq(reactions.userId, userId), eq(reactions.emoji, emoji)))
    .returning({ emoji: reactions.emoji });
  if (removed.length === 0) {
    await db.insert(reactions).values({ messageId, userId, emoji }).onConflictDoNothing();
  }
  const map = await reactionsFor(db, [messageId]);
  return { messageId, channelId: message.channelId, reactions: map.get(messageId) ?? [] };
}

/** Moves the user's read marker forward (never backwards). */
export async function markRead(db: Db, userId: string, channelId: string, messageId: number): Promise<void> {
  await db
    .update(channelMembers)
    .set({ lastReadMessageId: sql`greatest(${channelMembers.lastReadMessageId}, ${messageId})` })
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
}

/**
 * Full-text search (Postgres `websearch_to_tsquery`) across the channels the user is in.
 *
 * @param query - Free text; supports quotes, `or` and `-exclusions`.
 */
export async function searchMessages(db: Db, userId: string, query: string, limit = 30): Promise<SearchHit[]> {
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`;
  const rows = await db
    .select({ ...messageColumns, channelName: channels.name, channelKind: channels.kind })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.userId))
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .innerJoin(
      channelMembers,
      and(eq(channelMembers.channelId, messages.channelId), eq(channelMembers.userId, userId)),
    )
    .where(sql`${messages.search} @@ ${tsQuery}`)
    .orderBy(desc(sql`ts_rank(${messages.search}, ${tsQuery})`), desc(messages.id))
    .limit(Math.min(Math.max(limit, 1), 50));
  const hydrated = await hydrate(db, rows);
  return hydrated.map((dto, index) => ({
    ...dto,
    channelName: rows[index]?.channelName ?? null,
    channelKind: rows[index]?.channelKind ?? "public",
  }));
}
