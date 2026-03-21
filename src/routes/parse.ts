import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { parsePrompt } from "../parse.js";
import type { ParseRequest } from "../parse.js";

export const parseRoutes = new Hono();

parseRoutes.post("/v1/parse", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json<ParseRequest>();

  if (!body.prompt || typeof body.prompt !== "string") {
    return c.json({ error: "prompt is required and must be a string" }, 400);
  }

  if (body.prompt.length > 50_000) {
    return c.json({ error: "prompt must be less than 50,000 characters" }, 400);
  }

  if (body.model !== undefined && typeof body.model !== "string") {
    return c.json({ error: "model must be a string" }, 400);
  }

  if (body.execute !== undefined && typeof body.execute !== "boolean") {
    return c.json({ error: "execute must be a boolean" }, 400);
  }

  if (body.test_input !== undefined && typeof body.test_input !== "string") {
    return c.json({ error: "test_input must be a string" }, 400);
  }

  if (body.test_input && body.test_input.length > 10_000) {
    return c.json({ error: "test_input must be less than 10,000 characters" }, 400);
  }

  if (body.metadata !== undefined && typeof body.metadata !== "object") {
    return c.json({ error: "metadata must be an object" }, 400);
  }

  const result = await parsePrompt(body);
  return c.json(result);
});
