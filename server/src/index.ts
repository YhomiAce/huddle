import { loadConfig } from "./config.js";
import { startHuddle } from "./server.js";

/** Boots Huddle: migrate, seed, then serve HTTP + Socket.IO on PORT. */
async function main(): Promise<void> {
  const config = loadConfig();
  const huddle = await startHuddle(config);
  console.log(`Huddle listening on http://${config.HOST}:${config.PORT}`);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down.`);
    setTimeout(() => process.exit(1), 10_000).unref();
    void huddle.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("Failed to start Huddle:", err instanceof Error ? err.message : err);
  process.exit(1);
});
