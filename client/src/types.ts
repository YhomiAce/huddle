export type PresenceStatus = "online" | "away" | "offline";

export interface PublicUser {
  id: string;
  displayName: string;
  avatarColor: string;
}

export interface SelfUser extends PublicUser {
  email: string;
}

export interface DirectoryUser extends PublicUser {
  status: PresenceStatus;
}

export interface ChannelSummary {
  id: string;
  kind: "public" | "dm";
  name: string | null;
  topic: string;
  joined: boolean;
  memberCount: number;
  unread: number;
  dmUserId: string | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface Message {
  id: number;
  channelId: string;
  author: PublicUser;
  body: string;
  html: string;
  createdAt: string;
  editedAt: string | null;
  reactions: ReactionSummary[];
}

export interface MessagePage {
  messages: Message[];
  nextCursor: string | null;
}

export interface SearchHit extends Message {
  channelName: string | null;
  channelKind: "public" | "dm";
}

export interface AppConfig {
  demoMode: boolean;
  demoCredentials: { emails: string[]; password: string } | null;
}

export const AVATAR_COLORS = [
  "#e11d48",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0d9488",
  "#0284c7",
  "#4f46e5",
  "#9333ea",
  "#c026d3",
  "#475569",
] as const;

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "🚀", "👀", "🙏", "✅"] as const;
