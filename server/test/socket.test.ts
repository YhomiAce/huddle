import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { loadConfig, type Config } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import type { User } from "../src/db/schema.js";
import { startHuddle, type RunningHuddle } from "../src/server.js";
import { createChannel, joinChannel } from "../src/services/channels.js";
import type { MessageDto } from "../src/services/messages.js";
import { SessionStore } from "../src/services/sessions.js";
import { TEST_DATABASE_URL, TEST_REDIS_PREFIX, TEST_REDIS_URL } from "./env.js";
import { makeUser, openTestDb, resetDb } from "./helpers.js";

const config: Config = loadConfig({
  NODE_ENV: "test",
  PORT: "0",
  HOST: "127.0.0.1",
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  SESSION_SECRET: "test-session-secret-0123456789",
  REDIS_PREFIX: `${TEST_REDIS_PREFIX}-${process.pid}`,
});

function once<T>(socket: Socket, event: string, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function connectAs(huddle: RunningHuddle, token: string): Promise<Socket> {
  const socket = connect(huddle.url, {
    transports: ["websocket"],
    extraHeaders: { cookie: `huddle_session=${token}` },
    reconnection: false,
  });
  await once(socket, "connect");
  return socket;
}

describe("Socket.IO realtime", () => {
  let database: Database;
  let instanceA: RunningHuddle;
  let instanceB: RunningHuddle;
  let ada: User;
  let linus: User;
  let channelId: string;
  let adaToken: string;
  let linusToken: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    database = openTestDb();
    await resetDb(database);
    ada = await makeUser(database, "Ada");
    linus = await makeUser(database, "Linus");
    channelId = (await createChannel(database.db, ada.id, { name: "realtime" })).id;
    await joinChannel(database.db, linus.id, channelId);
    const sessions = new SessionStore(database.db, config.SESSION_SECRET);
    adaToken = (await sessions.create(ada.id)).token;
    linusToken = (await sessions.create(linus.id)).token;
    // Two instances sharing Postgres and the Redis adapter, like a scaled deployment.
    instanceA = await startHuddle(config, { prepareDatabase: false });
    instanceB = await startHuddle(config, { prepareDatabase: false });
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await instanceA?.close();
    await instanceB?.close();
    await database?.pool.end();
  });

  it("rejects sockets without a valid session", async () => {
    const socket = connect(instanceA.url, { transports: ["websocket"], reconnection: false });
    const err = await once<Error>(socket, "connect_error");
    expect(err.message).toBe("unauthorized");
    socket.disconnect();
  });

  it("delivers a message from one client to another on the same instance", async () => {
    const sender = await connectAs(instanceA, adaToken);
    const receiver = await connectAs(instanceA, linusToken);
    sockets.push(sender, receiver);

    const received = once<MessageDto>(receiver, "message:new");
    const ack = await sender.emitWithAck("message:send", { channelId, body: "hello from **Ada**" });
    expect(ack).toMatchObject({ ok: true });
    const message = await received;
    expect(message.body).toBe("hello from **Ada**");
    expect(message.html).toBe("hello from <strong>Ada</strong>");
    expect(message.author.id).toBe(ada.id);
  });

  it("fans out across instances through the Redis adapter", async () => {
    const sender = await connectAs(instanceA, adaToken);
    const receiver = await connectAs(instanceB, linusToken);
    sockets.push(sender, receiver);

    const typing = once<{ isTyping: boolean; user: { id: string } }>(receiver, "typing");
    sender.emit("typing", { channelId, isTyping: true });
    expect(await typing).toMatchObject({ isTyping: true, user: { id: ada.id } });

    const received = once<MessageDto>(receiver, "message:new");
    await sender.emitWithAck("message:send", { channelId, body: "across instances" });
    expect((await received).body).toBe("across instances");
  });

  it("acks permission errors cleanly", async () => {
    const linusSocket = await connectAs(instanceB, linusToken);
    const adaSocket = await connectAs(instanceA, adaToken);
    sockets.push(linusSocket, adaSocket);
    const sent = (await adaSocket.emitWithAck("message:send", { channelId, body: "mine" })) as {
      ok: true;
      data: MessageDto;
    };
    const ack = await linusSocket.emitWithAck("message:edit", { messageId: sent.data.id, body: "yours now" });
    expect(ack).toEqual({ ok: false, error: { code: "forbidden", message: "You can only change your own messages." } });
    const invalid = await linusSocket.emitWithAck("message:send", { channelId, body: "   " });
    expect(invalid).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });

  it("tracks presence in Redis", async () => {
    const watcher = await connectAs(instanceA, adaToken);
    sockets.push(watcher);
    const linusSocket = await connectAs(instanceB, linusToken);
    const away = once<{ userId: string; status: string }>(watcher, "presence");
    await linusSocket.emitWithAck("presence:set", { status: "away" });
    // Linus has other sockets open from earlier tests, which are still online.
    expect(await away).toMatchObject({ userId: linus.id });
    linusSocket.disconnect();
  });
});
