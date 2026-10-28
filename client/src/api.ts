import type {
  AppConfig,
  ChannelSummary,
  DirectoryUser,
  MessagePage,
  SearchHit,
  SelfUser,
} from "./types.ts";

/** Error thrown for non-2xx API responses, carrying the server's message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? "error", error?.message ?? `Request failed (${response.status})`);
  }
  return data as T;
}

/** Typed wrappers around the Huddle REST API. */
export const api = {
  config: () => request<AppConfig>("GET", "/api/config"),
  me: () => request<{ user: SelfUser }>("GET", "/api/auth/me"),
  login: (email: string, password: string) => request<{ user: SelfUser }>("POST", "/api/auth/login", { email, password }),
  signup: (email: string, password: string, displayName: string) =>
    request<{ user: SelfUser }>("POST", "/api/auth/signup", { email, password, displayName }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  updateProfile: (patch: { displayName?: string; avatarColor?: string }) =>
    request<{ user: SelfUser }>("PATCH", "/api/auth/me", patch),
  users: () => request<{ users: DirectoryUser[] }>("GET", "/api/users"),
  channels: () => request<{ channels: ChannelSummary[] }>("GET", "/api/channels"),
  createChannel: (name: string, topic: string) =>
    request<{ channel: { id: string } }>("POST", "/api/channels", { name, topic }),
  joinChannel: (id: string) => request<unknown>("POST", `/api/channels/${id}/join`),
  leaveChannel: (id: string) => request<unknown>("POST", `/api/channels/${id}/leave`),
  setTopic: (id: string, topic: string) => request<unknown>("PATCH", `/api/channels/${id}`, { topic }),
  openDm: (userId: string) => request<{ channel: { id: string } }>("POST", "/api/dms", { userId }),
  messages: (channelId: string, cursor?: string | null) =>
    request<MessagePage>(
      "GET",
      `/api/channels/${channelId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  search: (q: string) => request<{ results: SearchHit[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`),
};
