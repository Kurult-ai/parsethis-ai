import { Hono } from "hono";
import { stream } from "hono/streaming";
import { authMiddleware } from "../auth.js";
import { handleChat, handleChatStream } from "../chat.js";
import { getAvailableModels } from "../model-client.js";
import type { ChatRequest } from "../types.js";

const ALLOWED_MODELS = new Set(getAvailableModels().map((m) => m.id));

export const chatRoutes = new Hono();

chatRoutes.post("/v1/chat", authMiddleware("chat"), async (c) => {
  const body = await c.req.json<ChatRequest>();

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "messages array is required and must be non-empty" }, 400);
  }

  if (body.messages.length > 100) {
    return c.json({ error: "messages array must have at most 100 items" }, 400);
  }

  const validRoles = ["user", "assistant", "system"];
  for (const msg of body.messages) {
    if (!msg.role || !validRoles.includes(msg.role)) {
      return c.json({ error: `Each message must have a role of: ${validRoles.join(", ")}` }, 400);
    }
    if (!msg.content || typeof msg.content !== "string") {
      return c.json({ error: "Each message must have a content string" }, 400);
    }
    if (msg.content.length > 50_000) {
      return c.json({ error: "Each message content must be less than 50,000 characters" }, 400);
    }
  }

  if (body.model !== undefined && typeof body.model !== "string") {
    return c.json({ error: "model must be a string" }, 400);
  }

  if (body.model && !ALLOWED_MODELS.has(body.model)) {
    return c.json({ error: "Model not in allowlist", available_models: [...ALLOWED_MODELS] }, 400);
  }

  // Streaming mode
  if (body.stream) {
    return stream(c, async (stream) => {
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");

      for await (const chunk of handleChatStream(body.messages, body.context, body.model)) {
        await stream.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
      await stream.write("data: [DONE]\n\n");
    });
  }

  const response = await handleChat(body.messages, body.context, body.model);
  return c.json(response);
});
