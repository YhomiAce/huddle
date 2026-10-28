import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import type { PresenceStore } from "../../realtime/presence.js";
import { searchMessages } from "../../services/messages.js";
import { listUsers } from "../../services/users.js";
import { currentUser } from "../session.js";
import { parse } from "../validate.js";

const searchQuery = z.object({ q: z.string().trim().min(1, "Type something to search for.").max(200) });

/**
 * People directory (with presence) and message search, mounted at `/api`.
 *
 * @param deps - Database and presence store.
 */
export function directoryRouter(deps: { db: Db; presence: PresenceStore }): Router {
  const { db, presence } = deps;
  const router = Router();

  router.get("/users", async (req, res) => {
    currentUser(req);
    const users = await listUsers(db);
    const statuses = await presence.statusOfMany(users.map((u) => u.id));
    res.json({ users: users.map((u) => ({ ...u, status: statuses[u.id] ?? "offline" })) });
  });

  router.get("/search", async (req, res) => {
    const me = currentUser(req);
    const { q } = parse(searchQuery, req.query);
    res.json({ results: await searchMessages(db, me.id, q) });
  });

  return router;
}
