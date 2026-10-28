import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Config } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations, withStartupLock } from "./db/migrate.js";
import { seedIfEmpty } from "./db/seed.js";
import { createRedis } from "./lib/redis.js";
import { PresenceStore } from "./realtime/presence.js";
import { createSocketServer, type HuddleServer } from "./realtime/socket.js";
import { SessionStore } from "./services/sessions.js";
import { getWorkspace } from "./services/channels.js";
import { createApp } from "./app.js";
import { TaskTracker } from "./lib/tasks.js";

/** A running Huddle instance. */
export interface RunningHuddle {
  httpServer: HttpServer;
  io: HuddleServer;
  /** Base URL, e.g. `http://127.0.0.1:3000`. */
  url: string;
  /** Stops accepting connections and closes Postgres and Redis. */
  close: () => Promise<void>;
}

/**
 * Wires everything together and starts listening.
 *
 * @param config - Validated configuration.
 * @param options.prepareDatabase - Run migrations and the demo seed first (default true).
 */
export async function startHuddle(
  config: Config,
  options: { prepareDatabase?: boolean } = {},
): Promise<RunningHuddle> {
  const { db, pool } = createDatabase(config.DATABASE_URL);

  if (options.prepareDatabase !== false) {
    await withStartupLock(pool, async () => {
      await runMigrations(db);
      if (await seedIfEmpty(db)) console.log("Seeded demo workspace (ada/linus/grace@huddle.dev).");
      await getWorkspace(db);
    });
    console.log("Database migrations are up to date.");
  }

  const redis = createRedis(config.REDIS_URL, "huddle-cmd");
  // The adapter needs two connections: a subscribed connection can't run other commands.
  const pubClient = createRedis(config.REDIS_URL, "huddle-pub");
  const subClient = createRedis(config.REDIS_URL, "huddle-sub");

  const sessions = new SessionStore(db, config.SESSION_SECRET);
  const presence = new PresenceStore(redis, config.REDIS_PREFIX);

  const tasks = new TaskTracker();
  const httpServer = createServer();
  const io = createSocketServer(httpServer, {
    tasks,
    db,
    sessions,
    presence,
    pubClient,
    subClient,
    redisPrefix: config.REDIS_PREFIX,
  });
  httpServer.on("request", createApp({ config, db, pool, redis, sessions, presence, io }));

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.PORT, config.HOST, () => resolve());
  });
  const { port } = httpServer.address() as AddressInfo;
  const host = config.HOST === "0.0.0.0" ? "127.0.0.1" : config.HOST;

  return {
    httpServer,
    io,
    url: `http://${host}:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
      await tasks.drain();
      await Promise.allSettled([pool.end(), redis.quit(), pubClient.quit(), subClient.quit()]);
    },
  };
}
