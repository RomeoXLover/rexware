import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Logger } from "vite";

function createFilteredLogger(logger: Logger): Logger {
  return {
    ...logger,
    warn(msg, options) {
      if (typeof msg === "string" && msg.includes("inputValidator()")) return;
      logger.warn(msg, options);
    },
    warnOnce(msg, options) {
      if (typeof msg === "string" && msg.includes("inputValidator()")) return;
      logger.warnOnce(msg, options);
    },
  };
}

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    importProtection: {
      server: { files: [] },
    },
  },
  nitro: {
    preset: "vercel",
    externals: {
      external: ["dockerode", "ssh2", "bindings", "cpu-features", "docker-modem"],
      inline: ["jsonwebtoken", "pg"],
    },
  },
  vite: {
    server: { allowedHosts: ["skyutils.xyz"] },
    customLogger: undefined as never,
    optimizeDeps: {
      exclude: ["better-sqlite3", "bindings", "dockerode", "ssh2", "cpu-features", "docker-modem"],
    },
    build: {
      rollupOptions: {
        external: [
          "better-sqlite3",
          "bindings",
          "dockerode",
          "docker-modem",
          "ssh2",
          "cpu-features",
          "pg-native",
          "fs",
          "path",
        ],
      },
    },
    plugins: [
      {
        name: "filter-tanstack-warnings",
        configResolved(config) {
          const original = config.logger;
          (config as { logger: Logger }).logger = createFilteredLogger(original);
        },
      },
    ],
  },
});
