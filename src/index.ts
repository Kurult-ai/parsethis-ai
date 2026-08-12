import "dotenv/config";
import { execFileSync } from "node:child_process";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { cleanup } from "./auth.js";
import { disconnectDb } from "./db.js";
import { getRedis, disconnectRedis } from "./redis.js";
import { runMigrations } from "./migrate.js";
import { ensureSelfServiceUser } from "./lib/self-service-user.js";
import { runSemanticPreflight } from "./lib/semantic-preflight.js";

// ── Deployment identity ──────────────────────────────────────────────────
// Production runs `node --import tsx src/index.ts` straight from the checkout,
// so none of the platform build variables (RAILWAY_GIT_COMMIT_SHA and friends)
// are ever set and /health and /status reported commit "unknown". Read the SHA
// from git once at boot instead.
//
// getDeploymentMetadata() reads process.env on every call rather than caching at
// import time, so populating the variables here — before the server accepts a
// request — is enough for every route that reports build identity.
function populateBuildInfo(): void {
  if (!process.env.PARSE_COMMIT_SHA) {
    try {
      const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: process.cwd(),
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      }).trim();
      if (sha) process.env.PARSE_COMMIT_SHA = sha;
    } catch {
      // No git binary, or the deploy is not a checkout (tarball, container
      // layer). Leave it unset so build-info falls back to "unknown" — a
      // missing commit must never stop the service from booting.
    }
  }
  if (!process.env.PARSE_BUILD_TIME) {
    // Running from source, so the build is the boot: there is no separate
    // compile step whose timestamp would be more accurate.
    process.env.PARSE_BUILD_TIME = new Date().toISOString();
  }
}

populateBuildInfo();

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
void runMigrations()
  .catch((err) => {
    console.error(`[migrate] startup migration failed: ${(err as Error).message}`);
    if (process.env.MIGRATIONS_REQUIRED === "true") {
      shutdown("MIGRATIONS_REQUIRED");
    } else {
      console.warn("[migrate] continuing startup with degraded database-dependent routes");
    }
  })
  // Deliberately after the catch, so it runs whether or not migrations
  // succeeded — a half-migrated database is exactly when this row goes missing.
  // Not only in the migration file either: a database built with `prisma db
  // push` never runs the SQL migrations at all. This row is what stands between
  // a paying customer and a key that cannot be upgraded, and one idempotent
  // upsert on a fixed id is cheap enough to pay for on every boot.
  .then(() =>
    ensureSelfServiceUser().catch((err) => {
      console.error(`[startup] could not ensure the self-service user: ${(err as Error).message}`);
      console.warn("[startup] signup keys will fall back to Redis and checkout cannot grant a tier");
    }),
  );

// Ask the model provider, once, whether it will actually answer us — and say
// so in the log. The semantic layer has twice been silently dead in production
// (a placeholder key, then a bad one) with every response still looking
// complete, and both times the first signal was a customer's screening call
// failing. Same non-blocking shape as migrations above: a bad model key must
// cost us the semantic layer, never the API. runSemanticPreflight resolves
// rather than throwing, so nothing here can take the process down.
void runSemanticPreflight();

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
