import type { NextFunction, Request, Response } from "express";
import type { User } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { SESSION_COOKIE, type SessionStore } from "../services/sessions.js";

declare module "express-serve-static-core" {
  interface Request {
    /** The signed-in user, when the session cookie is valid. */
    user?: User;
  }
}

/**
 * Express middleware that resolves the session cookie into `req.user`.
 *
 * @param sessions - Session store.
 */
export function loadSession(sessions: SessionStore) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const user = await sessions.resolve(typeof token === "string" ? token : undefined);
    if (user) req.user = user;
    next();
  };
}

/**
 * Returns the signed-in user.
 *
 * @throws AppError(401) when nobody is signed in.
 */
export function currentUser(req: Request): User {
  if (!req.user) throw new AppError(401, "unauthorized", "Please sign in.");
  return req.user;
}

/**
 * Sets the session cookie. `Secure` follows `req.secure`, which honours
 * `X-Forwarded-Proto` when `trust proxy` is on, so it works behind TLS-terminating proxies
 * and still works over plain http on localhost.
 */
export function setSessionCookie(req: Request, res: Response, token: string, expires: Date): void {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/", expires });
}

/** Clears the session cookie. */
export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/" });
}
