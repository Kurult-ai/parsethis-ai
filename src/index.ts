import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { cleanup } from "./auth.js";

const port = parseInt(process.env.PORT || "3000");

console.log(`Parse for Agents API starting on port ${port}`);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});

function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  cleanup();
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
