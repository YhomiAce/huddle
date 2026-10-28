import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import type { Channel } from "../../db/schema.js";
import {
  channelMemberIds,
  createChannel,
  joinChannel,
  leaveChannel,
  listChannelsForUser,
  openDirectMessage,
  setTopic,
} from "../../services/channels.js";
import { listMessages, markRead, MAX_PAGE_SIZE } from "../../services/messages.js";
import { channelRoom, userRoom } from "../../realtime/rooms.js";
import type { HuddleServer } from "../../realtime/socket.js";
import { currentUser } from "../session.js";
import { parse } from "../validate.js";

const idParams = z.object({ id: z.uuid("Unknown channel.") });
const createBody = z.object({
  name: z.string().trim().min(1, "Channel name is required.").max(40),
  topic: z.string().trim().max(250).optional(),
});
const topicBody = z.object({ topic: z.string().trim().max(250) });
const dmBody = z.object({ userId: z.uuid() });
const readBody = z.object({ messageId: z.number().int().nonnegative() });
const historyQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

/** The public part of a channel, broadcast to everyone when it changes. */
function channelEvent(channel: Channel) {
  return { id: channel.id, kind: channel.kind, name: channel.name, topic: channel.topic };
}

/**
 * Channel, DM and history routes, mounted at `/api`.
 *
 * @param deps - Database and the Socket.IO server, used to move sockets between rooms.
 */
export function channelsRouter(deps: { db: Db; io: HuddleServer }): Router {
  const { db, io } = deps;
  const router = Router();

  router.get("/channels", async (req, res) => {
    res.json({ channels: await listChannelsForUser(db, currentUser(req).id) });
  });

  router.post("/channels", async (req, res) => {
    const me = currentUser(req);
    const channel = await createChannel(db, me.id, parse(createBody, req.body));
    io.in(userRoom(me.id)).socketsJoin(channelRoom(channel.id));
    io.emit("channel:created", channelEvent(channel));
    res.status(201).json({ channel: channelEvent(channel) });
  });

  router.post("/channels/:id/join", async (req, res) => {
    const me = currentUser(req);
    const channel = await joinChannel(db, me.id, parse(idParams, req.params).id);
    io.in(userRoom(me.id)).socketsJoin(channelRoom(channel.id));
    io.emit("channel:members", { channelId: channel.id, userId: me.id, joined: true });
    res.json({ channel: channelEvent(channel) });
  });

  router.post("/channels/:id/leave", async (req, res) => {
    const me = currentUser(req);
    const channel = await leaveChannel(db, me.id, parse(idParams, req.params).id);
    io.in(userRoom(me.id)).socketsLeave(channelRoom(channel.id));
    io.emit("channel:members", { channelId: channel.id, userId: me.id, joined: false });
    res.json({ channel: channelEvent(channel) });
  });

  router.patch("/channels/:id", async (req, res) => {
    const me = currentUser(req);
    const { topic } = parse(topicBody, req.body);
    const channel = await setTopic(db, me.id, parse(idParams, req.params).id, topic);
    io.to(channelRoom(channel.id)).emit("channel:updated", channelEvent(channel));
    res.json({ channel: channelEvent(channel) });
  });

  router.get("/channels/:id/messages", async (req, res) => {
    const { id } = parse(idParams, req.params);
    const query = parse(historyQuery, req.query);
    res.json(await listMessages(db, currentUser(req).id, id, query));
  });

  router.post("/channels/:id/read", async (req, res) => {
    const me = currentUser(req);
    const { id } = parse(idParams, req.params);
    const { messageId } = parse(readBody, req.body);
    await markRead(db, me.id, id, messageId);
    res.status(204).end();
  });

  router.post("/dms", async (req, res) => {
    const me = currentUser(req);
    const { userId } = parse(dmBody, req.body);
    const channel = await openDirectMessage(db, me.id, userId);
    for (const memberId of await channelMemberIds(db, channel.id)) {
      io.in(userRoom(memberId)).socketsJoin(channelRoom(channel.id));
    }
    io.to(userRoom(userId)).emit("dm:opened", { channelId: channel.id, userId: me.id });
    res.json({ channel: channelEvent(channel) });
  });

  return router;
}
