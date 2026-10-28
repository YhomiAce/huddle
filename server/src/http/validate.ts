import type { z } from "zod";
import { badRequest } from "../lib/errors.js";

/**
 * Validates untrusted input against a zod schema.
 *
 * @throws AppError(400) carrying the first validation message.
 */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw badRequest(`${where}${issue?.message ?? "Invalid input."}`);
  }
  return result.data;
}
