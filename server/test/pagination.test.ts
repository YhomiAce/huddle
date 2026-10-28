import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import type { User } from "../src/db/schema.js";
import { decodeCursor, encodeCursor } from "../src/lib/cursor.js";
import { AppError } from "../src/lib/errors.js";
import { createChannel } from "../src/services/channels.js";
import { listMessages, sendMessage } from "../src/services/messages.js";
import { makeUser, openTestDb, resetDb } from "./helpers.js";

describe("cursor pagination", () => {
  let database: Database;
  let ada: User;
  let channelId: string;
  const TOTAL = 25;

  beforeAll(async () => {
    database = openTestDb();
    await resetDb(database);
    ada = await makeUser(database, "Ada");
    channelId = (await createChannel(database.db, ada.id, { name: "history" })).id;
    for (let i = 1; i <= TOTAL; i += 1) await sendMessage(database.db, ada.id, channelId, `message ${i}`);
  });

  afterAll(async () => {
    await database.pool.end();
  });

  it("round-trips cursors and rejects garbage", () => {
    expect(decodeCursor(encodeCursor({ before: 42 }))).toEqual({ before: 42 });
    expect(() => decodeCursor("not-a-cursor")).toThrow(AppError);
    expect(() => decodeCursor(Buffer.from('{"before":-1}').toString("base64url"))).toThrow(AppError);
  });

  it("walks the whole history newest-first without gaps or duplicates", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listMessages(database.db, ada.id, channelId, { cursor, limit: 10 });
      // Each page is chronological (oldest first) for display.
      const ids = page.messages.map((m) => m.id);
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);
      seen.unshift(...page.messages.map((m) => m.body));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(Array.from({ length: TOTAL }, (_, i) => `message ${i + 1}`));
  });

  it("is stable when new messages arrive between pages", async () => {
    const first = await listMessages(database.db, ada.id, channelId, { limit: 5 });
    expect(first.messages.at(-1)?.body).toBe(`message ${TOTAL}`);
    await sendMessage(database.db, ada.id, channelId, "arrived while scrolling");
    const second = await listMessages(database.db, ada.id, channelId, { cursor: first.nextCursor ?? undefined, limit: 5 });
    expect(second.messages.map((m) => m.body)).toEqual([16, 17, 18, 19, 20].map((n) => `message ${n}`));
  });

  it("returns a null cursor on the last page", async () => {
    const page = await listMessages(database.db, ada.id, channelId, { limit: 100 });
    expect(page.nextCursor).toBeNull();
    expect(page.messages).toHaveLength(TOTAL + 1);
  });
});
