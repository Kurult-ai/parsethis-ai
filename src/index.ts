import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { cleanup } from "./auth.js";
import { disconnectDb } from "./db.js";
import { getRedis, disconnectRedis } from "./redis.js";
import { runMigrations } from "./migrate.js";

const port = parseInt(process.env.PORT || "3000");

// Initialize Redis connection (lazy connect — will connect on first use)
if (process.env.REDIS_URL) {
  getRedis();
  console.log(`Redis configured: ${process.env.REDIS_URL.replace(/\/\/.*@/, "//***@")}`);
}

console.log(`Parse API starting on port ${port}`);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});

// Migrations must not block liveness: Railway health checks begin shortly after
// container start, and a slow/unreachable database should degrade DB-backed routes
// rather than taking down public docs/pricing pages. Set MIGRATIONS_REQUIRED=true
// for strict one-shot migration jobs.
void runMigrations().catch((err) => {
  console.error(`[migrate] startup migration failed: ${(err as Error).message}`);
  if (process.env.MIGRATIONS_REQUIRED === "true") {
    shutdown("MIGRATIONS_REQUIRED");
  } else {
    console.warn("[migrate] continuing startup with degraded database-dependent routes");
  }
});

function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  cleanup();
  Promise.allSettled([
    disconnectDb(),
    disconnectRedis(),
  ]).then(() => {
    server.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
  });
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
