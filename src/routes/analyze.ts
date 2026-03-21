import { Hono } from "hono";
import { stream } from "hono/streaming";
import { authMiddleware } from "../auth.js";
import { startAnalysis, getAnalysis, listAnalyses } from "../analyzer.js";
import { validateUrl } from "../lib/ssrf-guard.js";
import type { AnalyzeRequest } from "../types.js";

export const analyzeRoutes = new Hono();

analyzeRoutes.post("/v1/analyze", authMiddleware("analyze"), async (c) => {
  const body = await c.req.json<AnalyzeRequest>();

  if (!body.url || typeof body.url !== "string") {
    return c.json({ error: "url is required and must be a string" }, 400);
  }

  if (body.url.length > 2048) {
    return c.json({ error: "url must be less than 2048 characters" }, 400);
  }

  // URL validation - must be http(s)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(body.url);
  } catch {
    return c.json({ error: "Invalid URL format" }, 400);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return c.json({ error: "URL must use http or https protocol" }, 400);
  }

  // SSRF protection — block internal/private IPs
  const ssrfCheck = await validateUrl(body.url);
  if (!ssrfCheck.safe) {
    return c.json({ error: "URL blocked by security policy", reason: ssrfCheck.reason }, 400);
  }

  const depth = body.depth || "standard";
  if (!["quick", "standard", "deep"].includes(depth)) {
    return c.json({ error: "depth must be quick, standard, or deep" }, 400);
  }

  if (body.webhook_url) {
    if (typeof body.webhook_url !== "string" || body.webhook_url.length > 2048) {
      return c.json({ error: "webhook_url must be a valid string under 2048 characters" }, 400);
    }
    try {
      const wh = new URL(body.webhook_url);
      if (!["http:", "https:"].includes(wh.protocol)) {
        return c.json({ error: "webhook_url must use http or https protocol" }, 400);
      }
    } catch {
      return c.json({ error: "Invalid webhook_url format" }, 400);
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
    return c.json({ error: "Analysis not found" }, 404);
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
    return c.json({ error: "Analysis not found" }, 404);
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
