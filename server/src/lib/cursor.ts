import { z } from "zod";
import { badRequest } from "./errors.js";

const cursorSchema = z.object({ before: z.number().int().positive() });

/** Position in a channel's history; the page holds messages with ids strictly below `before`. */
export type Cursor = z.infer<typeof cursorSchema>;

/**
 * Encodes a cursor as an opaque, URL-safe string.
 *
 * @param cursor - The position to encode.
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Decodes a cursor produced by {@link encodeCursor}.
 *
 * @param raw - The opaque cursor string from the client.
 * @throws AppError(400) when the cursor is malformed or tampered with.
 */
export function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return cursorSchema.parse(parsed);
  } catch {
    throw badRequest("Invalid cursor.");
  }
}
