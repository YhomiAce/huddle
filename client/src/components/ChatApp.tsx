import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { api } from "../api.ts";
import { connectSocket, request } from "../socket.ts";
import type {
  ChannelSummary,
  DirectoryUser,
  Message,
  PresenceStatus,
  PublicUser,
  ReactionSummary,
  SelfUser,
} from "../types.ts";
import { Sidebar } from "./Sidebar.tsx";
import { ChannelView, type History } from "./ChannelView.tsx";
import { SearchPanel } from "./SearchPanel.tsx";
import { ProfileDialog } from "./ProfileDialog.tsx";
import { NewChannelDialog } from "./NewChannelDialog.tsx";

interface Props {
  me: SelfUser;
  onMeChange: (user: SelfUser) => void;
  onSignedOut: () => void;
}

type TypingMap = Record<string, Record<string, { name: string; until: number }>>;

const HEARTBEAT_MS = 25_000;
const IDLE_MS = 5 * 60_000;
const ACTIVE_KEY = "huddle.activeChannel";

/** The signed-in chat experience: owns the socket and all live state. */
export function ChatApp({ me, onMeChange, onSignedOut }: Props) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<Record<string, DirectoryUser>>({});
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [histories, setHistories] = useState<Record<string, History>>({});
  const [typing, setTyping] = useState<TypingMap>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [myStatus, setMyStatus] = useState<Exclude<PresenceStatus, "offline">>("online");

  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const historiesRef = useRef(histories);
  historiesRef.current = histories;
  const statusRef = useRef(myStatus);
  statusRef.current = myStatus;
  /** Deleted ids, so a page fetched just before a delete can't resurrect the message. */
  const deletedRef = useRef(new Set<number>());

  const refreshChannels = useCallback(async () => {
    const { channels: list } = await api.channels();
    setChannels(list);
    return list;
  }, []);

  const refreshUsers = useCallback(async () => {
    const { users: list } = await api.users();
    setUsers(Object.fromEntries(list.map((u) => [u.id, u])));
  }, []);

  const patchHistory = useCallback((channelId: string, fn: (h: History) => History) => {
    setHistories((all) => {
      const current = all[channelId];
      return current ? { ...all, [channelId]: fn(current) } : all;
    });
  }, []);

  const markRead = useCallback(
    (channelId: string, messageId: number | undefined) => {
      setChannels((list) => list.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)));
      if (socket && messageId) void request(socket, "channel:read", { channelId, messageId }).catch(() => undefined);
    },
    [socket],
  );

  const loadLatest = useCallback(async (channelId: string) => {
    setHistories((all) => ({
      ...all,
      [channelId]: { messages: all[channelId]?.messages ?? [], nextCursor: null, loading: true, loaded: false },
    }));
    try {
      const page = await api.messages(channelId);
      setHistories((all) => {
        // Keep messages that arrived over the socket while the page was in flight.
        const newest = page.messages.at(-1)?.id ?? 0;
        const live = (all[channelId]?.messages ?? []).filter((m) => m.id > newest);
        const messages = [...page.messages, ...live].filter((m) => !deletedRef.current.has(m.id));
        return { ...all, [channelId]: { messages, nextCursor: page.nextCursor, loading: false, loaded: true } };
      });
      return page.messages.at(-1)?.id;
    } catch {
      setHistories((all) => {
        const rest = { ...all };
        delete rest[channelId];
        return rest;
      });
      return undefined;
    }
  }, []);

  const loadOlder = useCallback(async (channelId: string) => {
    const history = historiesRef.current[channelId];
    if (!history?.nextCursor || history.loading) return;
    const cursor = history.nextCursor;
    setHistories((all) => (all[channelId] ? { ...all, [channelId]: { ...all[channelId], loading: true } } : all));
    const page = await api.messages(channelId, cursor);
    setHistories((all) => {
      const current = all[channelId];
      if (!current) return all;
      const known = new Set(current.messages.map((m) => m.id));
      return {
        ...all,
        [channelId]: {
          messages: [
            ...page.messages.filter((m) => !known.has(m.id) && !deletedRef.current.has(m.id)),
            ...current.messages,
          ],
          nextCursor: page.nextCursor,
          loading: false,
          loaded: true,
        },
      };
    });
  }, []);

  // Initial data.
  useEffect(() => {
    void refreshUsers();
    void refreshChannels().then((list) => {
      const stored = activeRef.current;
      const valid = list.find((c) => c.id === stored);
      if (valid) return;
      const joined = list.filter((c) => c.kind === "public" && c.joined);
      setActiveId((joined.find((c) => c.name === "general") ?? joined[0] ?? list[0])?.id ?? null);
    });
  }, [refreshChannels, refreshUsers]);

  // Socket lifecycle and live events.
  useEffect(() => {
    const s = connectSocket();
    setSocket(s);

    let connectedBefore = false;
    s.on("connect", () => {
      setConnected(true);
      if (connectedBefore) {
        void refreshUsers();
        void refreshChannels();
        // Anything missed while disconnected: reload the open channel, drop the rest.
        const active = activeRef.current;
        setHistories({});
        if (active) void loadLatest(active);
      }
      connectedBefore = true;
      if (statusRef.current === "away") void request(s, "presence:set", { status: "away" }).catch(() => undefined);
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (err: Error) => {
      setConnected(false);
      if (err.message === "unauthorized") onSignedOut();
    });

    s.on("message:new", (message: Message) => {
      setHistories((all) => {
        const current = all[message.channelId];
        if (!current || current.messages.some((m) => m.id === message.id)) return all;
        return { ...all, [message.channelId]: { ...current, messages: [...current.messages, message] } };
      });
      setTyping((t) => {
        const forChannel = t[message.channelId];
        if (!forChannel?.[message.author.id]) return t;
        const rest = { ...forChannel };
        delete rest[message.author.id];
        return { ...t, [message.channelId]: rest };
      });
      const viewing = message.channelId === activeRef.current && document.visibilityState === "visible";
      if (message.author.id === me.id) return;
      if (viewing) {
        void request(s, "channel:read", { channelId: message.channelId, messageId: message.id }).catch(() => undefined);
        return;
      }
      setChannels((list) => {
        if (!list.some((c) => c.id === message.channelId)) {
          void refreshChannels();
          return list;
        }
        return list.map((c) => (c.id === message.channelId ? { ...c, unread: c.unread + 1 } : c));
      });
    });

    s.on("message:updated", (message: Message) => {
      setHistories((all) => {
        const current = all[message.channelId];
        if (!current) return all;
        return {
          ...all,
          [message.channelId]: { ...current, messages: current.messages.map((m) => (m.id === message.id ? message : m)) },
        };
      });
    });

    s.on("message:deleted", ({ id, channelId }: { id: number; channelId: string }) => {
      deletedRef.current.add(id);
      setHistories((all) => {
        const current = all[channelId];
        if (!current) return all;
        return { ...all, [channelId]: { ...current, messages: current.messages.filter((m) => m.id !== id) } };
      });
    });

    s.on(
      "reaction:updated",
      ({ messageId, channelId, reactions }: { messageId: number; channelId: string; reactions: ReactionSummary[] }) => {
        setHistories((all) => {
          const current = all[channelId];
          if (!current) return all;
          return {
            ...all,
            [channelId]: {
              ...current,
              messages: current.messages.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
            },
          };
        });
      },
    );

    s.on("typing", ({ channelId, user, isTyping }: { channelId: string; user: PublicUser; isTyping: boolean }) => {
      setTyping((t) => {
        const forChannel = { ...(t[channelId] ?? {}) };
        if (isTyping) forChannel[user.id] = { name: user.displayName, until: Date.now() + 6_000 };
        else delete forChannel[user.id];
        return { ...t, [channelId]: forChannel };
      });
    });

    s.on("presence", ({ userId, status }: { userId: string; status: PresenceStatus }) => {
      setUsers((all) => {
        const user = all[userId];
        if (!user) {
          void refreshUsers();
          return all;
        }
        return { ...all, [userId]: { ...user, status } };
      });
    });

    s.on("user:updated", (user: PublicUser) => {
      setUsers((all) => ({ ...all, [user.id]: { status: "offline", ...all[user.id], ...user } }));
    });

    s.on("channel:created", () => void refreshChannels());
    s.on("channel:members", () => void refreshChannels());
    s.on("dm:opened", () => void refreshChannels());
    s.on("channel:updated", ({ id, topic }: { id: string; topic: string }) => {
      setChannels((list) => list.map((c) => (c.id === id ? { ...c, topic } : c)));
    });
    s.on("channel:read", ({ channelId }: { channelId: string }) => {
      setChannels((list) => list.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)));
    });

    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [me.id, loadLatest, onSignedOut, refreshChannels, refreshUsers]);

  // Away when the tab is hidden or the user is idle; heartbeat keeps the Redis TTL fresh.
  useEffect(() => {
    if (!socket) return;
    let idleTimer: number | undefined;
    const setStatus = (status: "online" | "away") => {
      if (statusRef.current !== status) setMyStatus(status);
      statusRef.current = status;
      if (socket.connected) void request(socket, "presence:set", { status }).catch(() => undefined);
    };
    const onActivity = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setStatus("away"), IDLE_MS);
      if (statusRef.current === "away" && document.visibilityState === "visible") setStatus("online");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setStatus("away");
      else onActivity();
    };
    const heartbeat = window.setInterval(() => {
      if (socket.connected) void request(socket, "presence:set", { status: statusRef.current }).catch(() => undefined);
    }, HEARTBEAT_MS);
    const events = ["mousemove", "keydown", "pointerdown", "focus"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    onActivity();
    return () => {
      window.clearInterval(heartbeat);
      window.clearTimeout(idleTimer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [socket]);

  // Expire stale typing indicators (e.g. the typist closed their tab).
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTyping((t) => {
        let changed = false;
        const next: TypingMap = {};
        for (const [channelId, entries] of Object.entries(t)) {
          next[channelId] = {};
          for (const [userId, entry] of Object.entries(entries)) {
            if (entry.until > now) next[channelId][userId] = entry;
            else changed = true;
          }
        }
        return changed ? next : t;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Load the active channel when it changes.
  const activeChannel = channels.find((c) => c.id === activeId) ?? null;
  useEffect(() => {
    if (!activeId) return;
    localStorage.setItem(ACTIVE_KEY, activeId);
    if (!activeChannel?.joined) return;
    const history = historiesRef.current[activeId];
    if (history?.loaded) {
      markRead(activeId, history.messages.at(-1)?.id);
    } else if (!history?.loading) {
      void loadLatest(activeId).then((lastId) => markRead(activeId, lastId));
    }
  }, [activeId, activeChannel?.joined, loadLatest, markRead]);

  // Coming back to the tab clears the open channel's badge.
  useEffect(() => {
    const onVisible = () => {
      const id = activeRef.current;
      if (document.visibilityState !== "visible" || !id) return;
      markRead(id, historiesRef.current[id]?.messages.at(-1)?.id);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  const openDm = useCallback(
    async (userId: string) => {
      const { channel } = await api.openDm(userId);
      await refreshChannels();
      setActiveId(channel.id);
    },
    [refreshChannels],
  );

  const typingNames = useMemo(
    () => Object.values(activeId ? (typing[activeId] ?? {}) : {}).map((t) => t.name),
    [typing, activeId],
  );

  const totalUnread = channels.reduce((sum, c) => sum + (c.joined ? c.unread : 0), 0);
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Huddle` : "Huddle";
  }, [totalUnread]);

  return (
    <div className="chat">
      <Sidebar
        me={me}
        myStatus={myStatus}
        users={users}
        channels={channels}
        activeId={activeId}
        onSelect={setActiveId}
        onOpenDm={(id) => void openDm(id)}
        onNewChannel={() => setNewChannelOpen(true)}
        onProfile={() => setProfileOpen(true)}
      />
      <main className="main">
        {!connected && <div className="banner">Reconnecting…</div>}
        {activeChannel ? (
          <ChannelView
            key={activeChannel.id}
            me={me}
            socket={socket}
            channel={activeChannel}
            users={users}
            history={histories[activeChannel.id]}
            typingNames={typingNames}
            onLoadOlder={() => void loadOlder(activeChannel.id)}
            onJoin={async () => {
              await api.joinChannel(activeChannel.id);
              await refreshChannels();
            }}
            onLeave={async () => {
              await api.leaveChannel(activeChannel.id);
              patchHistory(activeChannel.id, (h) => ({ ...h, loaded: false }));
              await refreshChannels();
            }}
            onSearch={() => setSearchOpen(true)}
          />
        ) : (
          <div className="empty">Pick a channel to start chatting.</div>
        )}
      </main>
      {searchOpen && (
        <SearchPanel
          users={users}
          me={me}
          onClose={() => setSearchOpen(false)}
          onOpen={(channelId) => setActiveId(channelId)}
        />
      )}
      {profileOpen && (
        <ProfileDialog
          me={me}
          onClose={() => setProfileOpen(false)}
          onSaved={(user) => {
            onMeChange(user);
            setProfileOpen(false);
          }}
          onSignOut={async () => {
            await api.logout();
            onSignedOut();
          }}
        />
      )}
      {newChannelOpen && (
        <NewChannelDialog
          onClose={() => setNewChannelOpen(false)}
          onCreated={async (id) => {
            setNewChannelOpen(false);
            await refreshChannels();
            setActiveId(id);
          }}
        />
      )}
    </div>
  );
}
