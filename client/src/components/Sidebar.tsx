import type { ChannelSummary, DirectoryUser, PresenceStatus, SelfUser } from "../types.ts";
import { Avatar, PresenceDot } from "./Avatar.tsx";

interface Props {
  me: SelfUser;
  myStatus: Exclude<PresenceStatus, "offline">;
  users: Record<string, DirectoryUser>;
  channels: ChannelSummary[];
  activeId: string | null;
  onSelect: (channelId: string) => void;
  onOpenDm: (userId: string) => void;
  onNewChannel: () => void;
  onProfile: () => void;
}

/** Channel list, direct messages with presence, and the signed-in user's card. */
export function Sidebar({ me, myStatus, users, channels, activeId, onSelect, onOpenDm, onNewChannel, onProfile }: Props) {
  const publicChannels = channels.filter((c) => c.kind === "public");
  const dmByUser = new Map(channels.filter((c) => c.kind === "dm" && c.dmUserId).map((c) => [c.dmUserId, c]));
  const people = Object.values(users)
    .filter((u) => u.id !== me.id)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <aside className="sidebar">
      <header className="workspace">Huddle</header>
      <nav>
        <div className="section-title">
          <span>Channels</span>
          <button className="icon" onClick={onNewChannel} title="Create a channel" aria-label="Create a channel">
            +
          </button>
        </div>
        <ul>
          {publicChannels.map((c) => (
            <li key={c.id}>
              <button
                className={`nav-item${c.id === activeId ? " active" : ""}${c.unread > 0 ? " unread" : ""}${c.joined ? "" : " not-joined"}`}
                onClick={() => onSelect(c.id)}
              >
                <span className="hash">#</span>
                <span className="label">{c.name}</span>
                {c.joined && c.unread > 0 && <span className="badge">{c.unread}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="section-title">
          <span>Direct messages</span>
        </div>
        <ul>
          {people.map((u) => {
            const dm = dmByUser.get(u.id);
            return (
              <li key={u.id}>
                <button
                  className={`nav-item${dm && dm.id === activeId ? " active" : ""}${dm && dm.unread > 0 ? " unread" : ""}`}
                  onClick={() => (dm ? onSelect(dm.id) : onOpenDm(u.id))}
                >
                  <PresenceDot status={u.status} />
                  <span className="label">{u.displayName}</span>
                  {dm && dm.unread > 0 && <span className="badge">{dm.unread}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <button className="me" onClick={onProfile} title="Edit profile">
        <Avatar name={me.displayName} color={me.avatarColor} size={32} status={myStatus} />
        <span className="me-text">
          <strong>{me.displayName}</strong>
          <small>{myStatus === "online" ? "Active" : "Away"}</small>
        </span>
      </button>
    </aside>
  );
}
