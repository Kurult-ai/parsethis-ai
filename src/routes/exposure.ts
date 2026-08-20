import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { EXPOSURE_CATALOGS } from "../lib/exposure/catalog.js";
import { evaluateExposurePayload } from "../lib/exposure/evaluate.js";
import { sanitizeExposurePayload } from "../lib/exposure/sanitize.js";
import {
  endpointPreflightFailure,
  evaluateNumbatPreflight,
  NUMBAT_PREFLIGHT_MAX_BODY_BYTES,
  validateNumbatFindingBatch,
} from "../lib/exposure/numbat-preflight.js";
import { problem, ErrorCode, jsonContentTypeProblem } from "../lib/problem-response.js";
import { authMiddleware } from "../auth.js";

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

exposureRoutes.post("/v1/exposure/evaluate", async (c) => {
  const contentTypeProblem = jsonContentTypeProblem(c);
  if (contentTypeProblem) return contentTypeProblem;

  const body = await c.req.json();
  const sanitized = sanitizeExposurePayload(body);
  if (sanitized.ok === false) return invalidExposurePayload(c, sanitized.error);

  return c.json(evaluateExposurePayload(sanitized.value));
});

exposureRoutes.post("/v1/exposure/ingest", async (c) => {
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

exposureRoutes.post("/v1/exposure/numbat-preflight", authMiddleware("evaluate"), async (c) => {
  const contentType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return c.json(endpointPreflightFailure("invalid_type"), 400);
  }

  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > NUMBAT_PREFLIGHT_MAX_BODY_BYTES) {
    return c.json(endpointPreflightFailure("body_too_large"), 400);
  }

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json(endpointPreflightFailure("body_too_large"), 400);
  }
  if (Buffer.byteLength(rawBody, "utf8") > NUMBAT_PREFLIGHT_MAX_BODY_BYTES) {
    return c.json(endpointPreflightFailure("body_too_large"), 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json(endpointPreflightFailure("malformed_json"), 400);
  }
  const validation = validateNumbatFindingBatch(body);
  if (!validation.ok) return c.json(endpointPreflightFailure(validation.code), 400);
  return c.json(evaluateNumbatPreflight(validation.value));
});

exposureRoutes.get("/v1/exposure/catalogs", (c) => {
  return c.json({
    catalogs: EXPOSURE_CATALOGS,
    privacy_default: "findings_only",
    note: "Parse Exposure accepts sanitized Bumblebee-compatible findings. Managed cloud catalogs and persisted inventories are not enabled in phase 1.",
  });
});
