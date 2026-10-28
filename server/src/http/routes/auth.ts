import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { SESSION_COOKIE, type SessionStore } from "../../services/sessions.js";
import { AVATAR_COLORS, createUser, toSelfUser, updateProfile, verifyCredentials } from "../../services/users.js";
import { AppError } from "../../lib/errors.js";
import { clearSessionCookie, currentUser, setSessionCookie } from "../session.js";
import { parse } from "../validate.js";
import type { HuddleServer } from "../../realtime/socket.js";
import { toPublicUser } from "../../services/users.js";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254));
const displayName = z.string().trim().min(1, "Display name is required.").max(60);
const avatarColor = z.enum(AVATAR_COLORS);

const signupBody = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  displayName,
});
const loginBody = z.object({ email, password: z.string().min(1).max(200) });
const profileBody = z
  .object({ displayName: displayName.optional(), avatarColor: avatarColor.optional() })
  .refine((v) => v.displayName !== undefined || v.avatarColor !== undefined, "Nothing to update.");

/**
 * Sign up, sign in, sign out and profile routes, mounted at `/api/auth`.
 *
 * @param deps - Database, session store and the Socket.IO server (for profile broadcasts).
 */
export function authRouter(deps: { db: Db; sessions: SessionStore; io: HuddleServer }): Router {
  const { db, sessions, io } = deps;
  const router = Router();

  router.post("/signup", async (req, res) => {
    const input = parse(signupBody, req.body);
    const user = await createUser(db, input);
    const session = await sessions.create(user.id);
    setSessionCookie(req, res, session.token, session.expiresAt);
    io.emit("user:updated", toPublicUser(user));
    res.status(201).json({ user: toSelfUser(user) });
  });

  router.post("/login", async (req, res) => {
    const input = parse(loginBody, req.body);
    const user = await verifyCredentials(db, input.email, input.password);
    if (!user) throw new AppError(401, "invalid_credentials", "Wrong email or password.");
    const session = await sessions.create(user.id);
    setSessionCookie(req, res, session.token, session.expiresAt);
    res.json({ user: toSelfUser(user) });
  });

  router.post("/logout", async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    await sessions.destroy(typeof token === "string" ? token : undefined);
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  router.get("/me", (req, res) => {
    res.json({ user: toSelfUser(currentUser(req)) });
  });

  router.patch("/me", async (req, res) => {
    const me = currentUser(req);
    const user = await updateProfile(db, me.id, parse(profileBody, req.body));
    io.emit("user:updated", toPublicUser(user));
    res.json({ user: toSelfUser(user) });
  });

  return router;
}
