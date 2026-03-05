import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = parseInt(process.env.PORT || "3000");

console.log(`Parse for Agents API starting on port ${port}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});
