import { Redis } from "ioredis";

/**
 * Creates an ioredis client. Commands fail fast instead of queueing forever while Redis
 * is down, so `/health` reports the outage instead of hanging.
 *
 * @param url - A `redis://` URL; the path selects the database index.
 * @param name - Connection name shown in `CLIENT LIST`.
 */
export function createRedis(url: string, name: string): Redis {
  const client = new Redis(url, {
    connectionName: name,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });
  client.on("error", (err: Error) => console.error(`Redis (${name}) error:`, err.message));
  return client;
}
