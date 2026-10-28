import { io, type Socket } from "socket.io-client";

/** Response shape for every acknowledged socket request. */
export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/**
 * Opens the realtime connection. WebSocket first; long-polling only if WebSockets are
 * blocked (some corporate proxies). The session cookie authenticates the handshake.
 */
export function connectSocket(): Socket {
  return io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
    tryAllTransports: true,
    withCredentials: true,
  });
}

/**
 * Emits an event and resolves with the server's acknowledgement.
 *
 * @throws Error with the server's message when the request is rejected or times out.
 */
export async function request<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  const response = (await socket.timeout(10_000).emitWithAck(event, payload)) as AckResponse<T>;
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}
