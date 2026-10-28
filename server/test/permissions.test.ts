import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import type { User } from "../src/db/schema.js";
import { AppError } from "../src/lib/errors.js";
import { createChannel, joinChannel, leaveChannel, openDirectMessage, setTopic } from "../src/services/channels.js";
import {
  deleteMessage,
  editMessage,
  listMessages,
  searchMessages,
  sendMessage,
  toggleReaction,
} from "../src/services/messages.js";
import { makeUser, openTestDb, resetDb } from "./helpers.js";

async function expectAppError(promise: Promise<unknown>, status: number): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
}

describe("message permissions", () => {
  let database: Database;
  let ada: User;
  let linus: User;
  let grace: User;
  let channelId: string;

  beforeAll(async () => {
    database = openTestDb();
    await resetDb(database);
    ada = await makeUser(database, "Ada");
    linus = await makeUser(database, "Linus");
    grace = await makeUser(database, "Grace");
    const channel = await createChannel(database.db, ada.id, { name: "General Chat" });
    channelId = channel.id;
    await joinChannel(database.db, linus.id, channelId);
  });

  afterAll(async () => {
    await database.pool.end();
  });

  it("normalises channel names", async () => {
    const channel = await createChannel(database.db, ada.id, { name: "#Design Reviews!" });
    expect(channel.name).toBe("design-reviews");
    await expectAppError(createChannel(database.db, linus.id, { name: "design reviews" }), 409);
  });

  it("lets members post and blocks non-members", async () => {
    const message = await sendMessage(database.db, linus.id, channelId, "hello **team**");
    expect(message.html).toBe("hello <strong>team</strong>");
    await expectAppError(sendMessage(database.db, grace.id, channelId, "let me in"), 403);
    await expectAppError(listMessages(database.db, grace.id, channelId), 403);
  });

  it("lets authors edit their own messages only", async () => {
    const message = await sendMessage(database.db, ada.id, channelId, "tpyo");
    const edited = await editMessage(database.db, ada.id, message.id, "typo");
    expect(edited.body).toBe("typo");
    expect(edited.editedAt).not.toBeNull();
    await expectAppError(editMessage(database.db, linus.id, message.id, "hijacked"), 403);
  });

  it("lets authors delete their own messages only", async () => {
    const message = await sendMessage(database.db, ada.id, channelId, "delete me");
    await expectAppError(deleteMessage(database.db, linus.id, message.id), 403);
    await expect(deleteMessage(database.db, ada.id, message.id)).resolves.toEqual({ id: message.id, channelId });
    await expectAppError(deleteMessage(database.db, ada.id, message.id), 404);
  });

  it("revokes edit rights after leaving the channel", async () => {
    const message = await sendMessage(database.db, linus.id, channelId, "before leaving");
    await leaveChannel(database.db, linus.id, channelId);
    await expectAppError(editMessage(database.db, linus.id, message.id, "after leaving"), 403);
    await joinChannel(database.db, linus.id, channelId);
  });

  it("only members can react or change the topic", async () => {
    const message = await sendMessage(database.db, ada.id, channelId, "react to me");
    const added = await toggleReaction(database.db, linus.id, message.id, "🎉");
    expect(added.reactions).toEqual([{ emoji: "🎉", count: 1, userIds: [linus.id] }]);
    const removed = await toggleReaction(database.db, linus.id, message.id, "🎉");
    expect(removed.reactions).toEqual([]);
    await expectAppError(toggleReaction(database.db, grace.id, message.id, "👀"), 403);
    await expectAppError(setTopic(database.db, grace.id, channelId, "grace was here"), 403);
  });

  it("keeps DMs private to their two members", async () => {
    const dm = await openDirectMessage(database.db, ada.id, linus.id);
    const again = await openDirectMessage(database.db, linus.id, ada.id);
    expect(again.id).toBe(dm.id);
    await sendMessage(database.db, ada.id, dm.id, "secret plans for the kernel");
    await expectAppError(listMessages(database.db, grace.id, dm.id), 403);
    await expectAppError(joinChannel(database.db, grace.id, dm.id), 403);
    await expectAppError(openDirectMessage(database.db, ada.id, ada.id), 400);
  });

  it("only searches channels you belong to", async () => {
    const graceHits = await searchMessages(database.db, grace.id, "kernel");
    expect(graceHits).toHaveLength(0);
    const linusHits = await searchMessages(database.db, linus.id, "kernel");
    expect(linusHits.map((h) => h.body)).toContain("secret plans for the kernel");
  });
});
