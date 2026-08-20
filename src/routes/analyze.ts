import { Hono } from "hono";
import { stream } from "hono/streaming";
import { authMiddleware } from "../auth.js";
import { startAnalysis, getAnalysis, listAnalyses } from "../analyzer.js";
import { validateUrl } from "../lib/ssrf-guard.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";
import { problem, ErrorCode } from "../lib/problem-response.js";
import type { AnalyzeRequest } from "../types.js";

export const analyzeRoutes = new Hono();

analyzeRoutes.post("/v1/analyze", authMiddleware("analyze"), billableUsageMiddleware(), async (c) => {
  const body = await c.req.json<AnalyzeRequest>();

  if (!body.url || typeof body.url !== "string") {
    return problem(c, { status: 400, title: "Invalid input", detail: "url is required and must be a string", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
  }

  if (body.url.length > 2048) {
    return problem(c, { status: 400, title: "Invalid input", detail: "url must be less than 2048 characters", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
  }

  // URL validation - must be http(s)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(body.url);
  } catch {
    return problem(c, { status: 400, title: "Invalid input", detail: "Invalid URL format", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return problem(c, { status: 400, title: "Invalid input", detail: "URL must use http or https protocol", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
  }

  // SSRF protection — block internal/private IPs
  const ssrfCheck = await validateUrl(body.url);
  if (!ssrfCheck.safe) {
    return problem(c, { status: 400, title: "Invalid input", detail: "URL blocked by security policy", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false, reason: ssrfCheck.reason });
  }

  const depth = body.depth || "standard";
  if (!["quick", "standard", "deep"].includes(depth)) {
    return problem(c, { status: 400, title: "Invalid input", detail: "depth must be quick, standard, or deep", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
  }

  if (body.webhook_url) {
    if (typeof body.webhook_url !== "string" || body.webhook_url.length > 2048) {
      return problem(c, { status: 400, title: "Invalid input", detail: "webhook_url must be a valid string under 2048 characters", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
    }
    try {
      const wh = new URL(body.webhook_url);
      if (!["http:", "https:"].includes(wh.protocol)) {
        return problem(c, { status: 400, title: "Invalid input", detail: "webhook_url must use http or https protocol", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
      }
    } catch {
      return problem(c, { status: 400, title: "Invalid input", detail: "Invalid webhook_url format", code: ErrorCode.VALIDATION_INVALID_INPUT, retryable: false });
    }
  }

  const result = await startAnalysis(body.url, depth as any);

  return c.json(
    {
      id: result.id,
      status: result.status,
      poll_url: `/v1/analyze/${result.id}`,
      stream_url: `/v1/analyze/${result.id}/stream`,
    },
    202
  );
});

analyzeRoutes.get("/v1/analyze/:id", authMiddleware("analyze"), (c) => {
  const id = c.req.param("id")!;
  const result = getAnalysis(id);
  if (!result) {
    return problem(c, { status: 404, title: "Not found", detail: "Analysis not found", code: ErrorCode.RESOURCE_NOT_FOUND, retryable: false });
  }
  return c.json(result);
});

analyzeRoutes.get("/v1/analyses", authMiddleware("analyze"), (c) => {
  return c.json({ analyses: listAnalyses() });
});

// SSE stream for analysis progress
analyzeRoutes.get("/v1/analyze/:id/stream", authMiddleware("analyze"), async (c) => {
  const id = c.req.param("id")!;
  const result = getAnalysis(id);

  if (!result) {
    return problem(c, { status: 404, title: "Not found", detail: "Analysis not found", code: ErrorCode.RESOURCE_NOT_FOUND, retryable: false });
  }

  // If already completed, return final result
  if (result.status === "completed" || result.status === "error") {
    return c.json(result);
  }

  // Stream progress updates
  return stream(c, async (stream) => {
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    let lastProgress = -1;
    const maxWait = 120_000; // 2 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const current = getAnalysis(id);
      if (!current) break;

      if (current.progress !== lastProgress || current.status === "completed" || current.status === "error") {
        lastProgress = current.progress || 0;
        await stream.write(`data: ${JSON.stringify({
          status: current.status,
          progress: current.progress,
          agents_completed: current.agents_completed,
          agents_total: current.agents_total,
        })}\n\n`);
      }

      if (current.status === "completed" || current.status === "error") {
        await stream.write(`data: ${JSON.stringify(current)}\n\n`);
        break;
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
  });
});
