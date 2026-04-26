import { Hono } from "hono";
import { stream } from "hono/streaming";
import { authMiddleware } from "../auth.js";
import { handleChat, handleChatStream } from "../chat.js";
import { getAvailableModels } from "../model-client.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import type { ChatRequest } from "../types.js";

const ALLOWED_MODELS = new Set(getAvailableModels().map((m) => m.id));

export const chatRoutes = new Hono();

chatRoutes.post("/v1/chat", authMiddleware("chat"), billableUsageMiddleware(), async (c) => {
  const body = await c.req.json<ChatRequest>();

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return problem(c, { status: 400, title: "Invalid input", detail: "messages array is required and must be non-empty", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
  }

  if (body.messages.length > 100) {
    return problem(c, { status: 400, title: "Invalid input", detail: "messages array must have at most 100 items", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
  }

  const validRoles = ["user", "assistant", "system"];
  for (const msg of body.messages) {
    if (!msg.role || !validRoles.includes(msg.role)) {
      return problem(c, { status: 400, title: "Invalid input", detail: `Each message must have a role of: ${validRoles.join(", ")}`, code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
    }
    if (!msg.content || typeof msg.content !== "string") {
      return problem(c, { status: 400, title: "Invalid input", detail: "Each message must have a content string", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
    }
    if (msg.content.length > 50_000) {
      return problem(c, { status: 400, title: "Invalid input", detail: "Each message content must be less than 50,000 characters", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
    }
  }

  if (body.model !== undefined && typeof body.model !== "string") {
    return problem(c, { status: 400, title: "Invalid input", detail: "model must be a string", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
  }

  if (body.model && !ALLOWED_MODELS.has(body.model)) {
    return problem(c, { status: 400, title: "Invalid input", detail: "Model not in allowlist", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false, available_models: [...ALLOWED_MODELS] });
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
