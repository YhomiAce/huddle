import { useState } from "react";
import type { Socket } from "socket.io-client";
import { request } from "../socket.ts";
import { QUICK_REACTIONS, type Message, type PublicUser, type SelfUser } from "../types.ts";
import { Avatar } from "./Avatar.tsx";

interface Props {
  message: Message;
  author: PublicUser;
  me: SelfUser;
  socket: Socket | null;
  grouped: boolean;
  onError: (message: string) => void;
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** One message with hover actions: react, and edit/delete for your own messages. */
export function MessageItem({ message, author, me, socket, grouped, onError }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [picker, setPicker] = useState(false);
  const mine = message.author.id === me.id;

  async function call(event: string, payload: unknown) {
    if (!socket) return;
    try {
      await request(socket, event, payload);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function saveEdit() {
    const body = draft.trim();
    if (!body || body === message.body) {
      setEditing(false);
      return;
    }
    await call("message:edit", { messageId: message.id, body });
    setEditing(false);
  }

  return (
    <article className={`message${grouped ? " grouped" : ""}`} data-message-id={message.id}>
      <div className="gutter">
        {grouped ? <time className="hover-time">{time(message.createdAt)}</time> : <Avatar name={author.displayName} color={author.avatarColor} />}
      </div>
      <div className="content">
        {!grouped && (
          <div className="meta">
            <strong>{author.displayName}</strong>
            <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
              {time(message.createdAt)}
            </time>
          </div>
        )}
        {editing ? (
          <div className="edit">
            <textarea
              autoFocus
              value={draft}
              maxLength={4000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void saveEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="edit-actions">
              <button onClick={() => setEditing(false)}>Cancel</button>
              <button className="primary small" onClick={() => void saveEdit()}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="body">
            {/* `html` is rendered and sanitized by the server's markdown-lite renderer. */}
            <span dangerouslySetInnerHTML={{ __html: message.html }} />
            {message.editedAt && <span className="edited"> (edited)</span>}
          </div>
        )}
        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                className={`reaction${r.userIds.includes(me.id) ? " mine" : ""}`}
                onClick={() => void call("reaction:toggle", { messageId: message.id, emoji: r.emoji })}
                title={`${r.count} reaction${r.count === 1 ? "" : "s"}`}
              >
                {r.emoji} <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!editing && (
        <div className="actions">
          <button title="Add reaction" aria-label="Add reaction" onClick={() => setPicker((p) => !p)}>
            ☺
          </button>
          {mine && (
            <>
              <button
                title="Edit"
                onClick={() => {
                  setDraft(message.body);
                  setEditing(true);
                }}
              >
                Edit
              </button>
              <button
                title="Delete"
                onClick={() => {
                  if (window.confirm("Delete this message? This can't be undone.")) {
                    void call("message:delete", { messageId: message.id });
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
          {picker && (
            <div className="picker">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    setPicker(false);
                    void call("reaction:toggle", { messageId: message.id, emoji });
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
