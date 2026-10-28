import { z } from "zod";

/** Messages are plain text with markdown-lite; 4000 characters is plenty for chat. */
export const messageBody = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "Message can't be empty.").max(4000, "Message is too long (4000 characters max)."));

const messageId = z.number().int().positive();
const channelId = z.uuid();

/** A single emoji (optionally with modifiers / ZWJ sequences). */
export const emoji = z
  .string()
  .min(1)
  .max(16)
  .regex(/^\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]*$/u, "Pick an emoji.");

export const sendMessageInput = z.object({ channelId, body: messageBody });
export const editMessageInput = z.object({ messageId, body: messageBody });
export const deleteMessageInput = z.object({ messageId });
export const toggleReactionInput = z.object({ messageId, emoji });
export const typingInput = z.object({ channelId, isTyping: z.boolean() });
export const readInput = z.object({ channelId, messageId });
export const presenceInput = z.object({ status: z.enum(["online", "away"]) });
