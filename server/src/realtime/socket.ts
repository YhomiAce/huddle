import type { Server as HttpServer, IncomingMessage } from "node:http";
import { Server, type DefaultEventsMap, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { AppError, toErrorResponse, type ErrorBody } from "../lib/errors.js";
import { parseCookieHeader } from "../lib/cookies.js";
import { SESSION_COOKIE, type SessionStore } from "../services/sessions.js";
import { channelIdsForUser } from "../services/channels.js";
import { deleteMessage, editMessage, markRead, sendMessage, toggleReaction } from "../services/messages.js";
import { toPublicUser, type PublicUser } from "../services/users.js";
import type { PresenceStore } from "./presence.js";
import {
  deleteMessageInput,
  editMessageInput,
  presenceInput,
  readInput,
  sendMessageInput,
  toggleReactionInput,
  typingInput,
} from "./validation.js";
import { channelRoom, userRoom } from "./rooms.js";
import type { TaskTracker } from "../lib/tasks.js";

/** Data attached to every authenticated socket. */
export interface SocketData {
  user: PublicUser;
}

/** Acknowledgement sent back for every client request. */
export type Ack<T> = (response: { ok: true; data: T } | ({ ok: false } & ErrorBody)) => void;

type HuddleSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/** Typed Socket.IO server used across the app. */
export type HuddleServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/** Dependencies of the realtime layer. */
export interface RealtimeDeps {
  db: Db;
  sessions: SessionStore;
  presence: PresenceStore;
  pubClient: Redis;
  subClient: Redis;
  redisPrefix: string;
  /** Tracks in-flight work so shutdown can wait for it before closing Redis/Postgres. */
  tasks: TaskTracker;
}

/**
 * Rejects cross-site handshakes. Cookies make the socket authenticated, so a page on
 * another origin must not be able to open one (cross-site WebSocket hijacking). Behind a
 * proxy the public host arrives as `Host` (Traefik keeps it) or `X-Forwarded-Host`.
 */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients (tests, CLIs) don't send Origin.
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)?.split(",")[0]?.trim() ?? req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Creates the Socket.IO server, wires the Redis adapter (so events reach sockets on every
 * instance) and registers chat event handlers.
 *
 * @param httpServer - The HTTP server to attach to.
 * @param deps - Database, session, presence and Redis dependencies.
 */
export function createSocketServer(httpServer: HttpServer, deps: RealtimeDeps): HuddleServer {
  const io: HuddleServer = new Server(httpServer, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    serveClient: false,
    allowRequest: (req, callback) => callback(null, isSameOrigin(req)),
    adapter: createAdapter(deps.pubClient, deps.subClient, { key: `${deps.redisPrefix}:socket.io` }),
  });

  io.use(async (socket, next) => {
    try {
      const token = parseCookieHeader(socket.handshake.headers.cookie)[SESSION_COOKIE];
      const user = await deps.sessions.resolve(token);
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = toPublicUser(user);
      next();
    } catch (err) {
      console.error("Socket auth failed:", err);
      next(new Error("unavailable"));
    }
  });

  io.on("connection", (socket) => onConnection(io, socket, deps));

  return io;
}

function onConnection(io: HuddleServer, socket: HuddleSocket, deps: RealtimeDeps): void {
  const { db, presence, tasks } = deps;
  const user = socket.data.user;
  const broadcastPresence = (status: string) => io.emit("presence", { userId: user.id, status });

  // Handlers are registered synchronously below so events sent right after "connect" are
  // never dropped; each one waits for the room joins to finish first.
  const ready = tasks.track(
    (async () => {
      const channelIds = await channelIdsForUser(db, user.id);
      await socket.join([userRoom(user.id), ...channelIds.map(channelRoom)]);
      broadcastPresence(await presence.touch(user.id, socket.id, "online"));
    })(),
  );
  ready.catch((err: unknown) => {
    console.error("Socket setup failed:", err);
    socket.disconnect(true);
  });

  /** Registers a request/response handler with zod validation and clean error acks. */
  const handle = <S extends z.ZodType, T>(event: string, schema: S, fn: (input: z.infer<S>) => Promise<T>) => {
    socket.on(event, async (payload: unknown, ack?: unknown) => {
      const reply: Ack<T> = typeof ack === "function" ? (ack as Ack<T>) : () => undefined;
      try {
        await ready;
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          throw new AppError(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid payload.");
        }
        reply({ ok: true, data: await tasks.track(fn(parsed.data)) });
      } catch (err) {
        reply({ ok: false, ...toErrorResponse(err).body });
      }
    });
  };

  handle("message:send", sendMessageInput, async ({ channelId, body }) => {
    const message = await sendMessage(db, user.id, channelId, body);
    io.to(channelRoom(channelId)).emit("message:new", message);
    return message;
  });

  handle("message:edit", editMessageInput, async ({ messageId, body }) => {
    const message = await editMessage(db, user.id, messageId, body);
    io.to(channelRoom(message.channelId)).emit("message:updated", message);
    return message;
  });

  handle("message:delete", deleteMessageInput, async ({ messageId }) => {
    const deleted = await deleteMessage(db, user.id, messageId);
    io.to(channelRoom(deleted.channelId)).emit("message:deleted", deleted);
    return deleted;
  });

  handle("reaction:toggle", toggleReactionInput, async ({ messageId, emoji }) => {
    const result = await toggleReaction(db, user.id, messageId, emoji);
    io.to(channelRoom(result.channelId)).emit("reaction:updated", result);
    return result;
  });

  handle("channel:read", readInput, async ({ channelId, messageId }) => {
    await markRead(db, user.id, channelId, messageId);
    // Other tabs of the same user clear their badge too.
    io.to(userRoom(user.id)).emit("channel:read", { channelId, messageId });
    return { channelId, messageId };
  });

  handle("presence:set", presenceInput, async ({ status }) => {
    const overall = await presence.touch(user.id, socket.id, status);
    broadcastPresence(overall);
    return { status: overall };
  });

  // Typing is fire-and-forget and high-frequency: check room membership in memory, no DB.
  socket.on("typing", (payload: unknown) => {
    const parsed = typingInput.safeParse(payload);
    if (!parsed.success) return;
    const room = channelRoom(parsed.data.channelId);
    if (!socket.rooms.has(room)) return;
    socket.to(room).emit("typing", { channelId: parsed.data.channelId, user, isTyping: parsed.data.isTyping });
  });

  socket.on("disconnect", () => {
    void tasks
      .track(ready.then(() => presence.remove(user.id, socket.id)))
      .then(broadcastPresence)
      .catch((err: unknown) => console.error("Presence cleanup failed:", err));
  });
}
