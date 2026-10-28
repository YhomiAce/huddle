import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { ChannelSummary, DirectoryUser, Message, SelfUser } from "../types.ts";
import { MessageItem } from "./MessageItem.tsx";
import { Composer } from "./Composer.tsx";
import { api } from "../api.ts";

/** Loaded history for one channel. */
export interface History {
  messages: Message[];
  nextCursor: string | null;
  loading: boolean;
  loaded: boolean;
}

interface Props {
  me: SelfUser;
  socket: Socket | null;
  channel: ChannelSummary;
  users: Record<string, DirectoryUser>;
  history: History | undefined;
  typingNames: string[];
  onLoadOlder: () => void;
  onJoin: () => Promise<void>;
  onLeave: () => Promise<void>;
  onSearch: () => void;
}

const GROUP_WINDOW_MS = 5 * 60_000;

function typingText(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** Header, scrollable history with infinite scroll up, typing line and composer. */
export function ChannelView(props: Props) {
  const { me, socket, channel, users, history, typingNames } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const prevHeight = useRef(0);
  const prevFirstId = useRef<number | undefined>(undefined);
  const prevLastId = useRef<number | undefined>(undefined);
  const stickToBottom = useRef(true);
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState(channel.topic);
  const [error, setError] = useState<string | null>(null);

  const dmUser = channel.dmUserId ? users[channel.dmUserId] : undefined;
  const title = channel.kind === "dm" ? (dmUser?.displayName ?? "Direct message") : `#${channel.name ?? ""}`;
  const messages = history?.messages ?? [];

  // Keep the viewport stable when older messages are prepended, and follow new ones.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const firstId = messages[0]?.id;
    const lastId = messages.at(-1)?.id;
    if (prevFirstId.current !== undefined && firstId !== prevFirstId.current && lastId === prevLastId.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (stickToBottom.current || messages.at(-1)?.author.id === me.id) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeight.current = el.scrollHeight;
    prevFirstId.current = firstId;
    prevLastId.current = lastId;
  }, [messages, me.id]);

  // Layout changes (search panel opening, window resize) shouldn't unstick the view.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [channel.joined]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && history?.nextCursor && !history.loading) props.onLoadOlder();
  }

  async function saveTopic() {
    try {
      await api.setTopic(channel.id, topicDraft);
      setEditingTopic(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the topic.");
    }
  }

  return (
    <section className="channel">
      <header className="channel-header">
        <div className="channel-title">
          <h2>{title}</h2>
          {channel.kind === "public" &&
            (editingTopic ? (
              <form
                className="topic-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveTopic();
                }}
              >
                <input
                  autoFocus
                  value={topicDraft}
                  maxLength={250}
                  onChange={(e) => setTopicDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setEditingTopic(false)}
                  placeholder="What's this channel about?"
                />
                <button className="primary small" type="submit">
                  Save
                </button>
              </form>
            ) : (
              <button
                className="topic"
                disabled={!channel.joined}
                onClick={() => {
                  setTopicDraft(channel.topic);
                  setEditingTopic(true);
                }}
                title={channel.joined ? "Edit topic" : undefined}
              >
                {channel.topic || (channel.joined ? "Add a topic" : "")}
              </button>
            ))}
          {dmUser && <span className="topic static">{dmUser.status === "online" ? "Active now" : dmUser.status === "away" ? "Away" : "Offline"}</span>}
        </div>
        <div className="channel-actions">
          {channel.kind === "public" && <span className="members">{channel.memberCount} members</span>}
          <button onClick={props.onSearch}>Search</button>
          {channel.kind === "public" && channel.joined && (
            <button onClick={() => void props.onLeave().catch((err: Error) => setError(err.message))}>Leave</button>
          )}
        </div>
      </header>
      {error && (
        <div className="banner error" role="alert">
          {error} <button className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {!channel.joined ? (
        <div className="join-prompt">
          <h3>#{channel.name}</h3>
          <p>{channel.topic || "No topic yet."}</p>
          <p className="muted">{channel.memberCount} members</p>
          <button className="primary" onClick={() => void props.onJoin().catch((err: Error) => setError(err.message))}>
            Join channel
          </button>
        </div>
      ) : (
        <>
          <div className="messages" ref={listRef} onScroll={onScroll} data-testid="message-list">
            {history?.loaded && !history.nextCursor && (
              <div className="history-start">
                This is the very beginning of <strong>{title}</strong>.
              </div>
            )}
            {history?.loading && <div className="loading">Loading…</div>}
            {messages.map((message, index) => {
              const prev = messages[index - 1];
              const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
              const grouped =
                !newDay &&
                prev?.author.id === message.author.id &&
                new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
              return (
                <div key={message.id}>
                  {newDay && (
                    <div className="day-divider">
                      <span>{dayLabel(message.createdAt)}</span>
                    </div>
                  )}
                  <MessageItem
                    message={message}
                    author={users[message.author.id] ?? message.author}
                    me={me}
                    socket={socket}
                    grouped={grouped}
                    onError={setError}
                  />
                </div>
              );
            })}
          </div>
          <div className="typing" aria-live="polite" data-testid="typing">
            {typingText(typingNames)}
          </div>
          <Composer socket={socket} channelId={channel.id} placeholder={`Message ${title}`} onError={setError} />
        </>
      )}
    </section>
  );
}
