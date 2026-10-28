import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const server = process.env.HUDDLE_SERVER_URL ?? "http://127.0.0.1:5113";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5114,
    strictPort: true,
    proxy: {
      "/api": server,
      "/health": server,
      "/socket.io": { target: server, ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
