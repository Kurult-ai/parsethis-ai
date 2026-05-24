import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import type { AppEnv } from "../types.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";
import { EXPOSURE_CATALOGS } from "../lib/exposure/catalog.js";
import { evaluateExposurePayload } from "../lib/exposure/evaluate.js";
import { sanitizeExposurePayload } from "../lib/exposure/sanitize.js";
import { problem, ErrorCode, jsonContentTypeProblem } from "../lib/problem-response.js";

export const exposureRoutes = new Hono<AppEnv>();

function invalidExposurePayload(c: Parameters<typeof problem>[0], detail: string) {
  return problem(c, {
    status: 400,
    title: "Invalid exposure payload",
    detail,
    code: ErrorCode.VALIDATION_INVALID_INPUT,
    retryable: false,
  });
}

exposureRoutes.post("/v1/exposure/evaluate", authMiddleware("evaluate"), billableUsageMiddleware(), async (c) => {
  const contentTypeProblem = jsonContentTypeProblem(c);
  if (contentTypeProblem) return contentTypeProblem;

  const body = await c.req.json();
  const sanitized = sanitizeExposurePayload(body);
  if (sanitized.ok === false) return invalidExposurePayload(c, sanitized.error);

  return c.json(evaluateExposurePayload(sanitized.value));
});

exposureRoutes.post("/v1/exposure/ingest", authMiddleware("evaluate"), billableUsageMiddleware(), async (c) => {
  const contentTypeProblem = jsonContentTypeProblem(c);
  if (contentTypeProblem) return contentTypeProblem;

  const body = await c.req.json();
  const sanitized = sanitizeExposurePayload(body);
  if (sanitized.ok === false) return invalidExposurePayload(c, sanitized.error);

  return c.json({
    ...evaluateExposurePayload(sanitized.value),
    stored: false,
    storage_mode: "stateless_phase_1",
  });
});

exposureRoutes.get("/v1/exposure/catalogs", (c) => {
  return c.json({
    catalogs: EXPOSURE_CATALOGS,
    privacy_default: "findings_only",
    note: "Parse Exposure accepts sanitized Bumblebee-compatible findings. Managed cloud catalogs and persisted inventories are not enabled in phase 1.",
  });
});
