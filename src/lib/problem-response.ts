import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const ErrorCode = {
  VALIDATION_REQUIRED: "validation.required",
  VALIDATION_TOO_LARGE: "validation.too_large",
  VALIDATION_INVALID_TYPE: "validation.invalid_type",
  VALIDATION_INVALID_INPUT: "validation.invalid_input",
  AUTH_MISSING: "auth.missing",
  AUTH_REQUIRED: "auth.required",
  AUTH_INVALID: "auth.invalid",
  AUTH_INVALID_KEY: "auth.invalid_key",
  AUTH_EXPIRED: "auth.expired",
  AUTH_INSUFFICIENT_SCOPE: "auth.insufficient_scope",
  AUTH_FORBIDDEN_ROLE: "auth.forbidden_role",
  RATE_LIMIT: "rate_limit.exceeded",
  USAGE_CAP: "usage_cap.exceeded",
  PAYMENT_REQUIRED: "payment.required",
  SERVICE_UNAVAILABLE: "service.unavailable",
  UPSTREAM_UNAVAILABLE: "upstream.unavailable",
  SANDBOX_UNAVAILABLE: "sandbox.unavailable",
  X402_ASYNC_UNSUPPORTED: "x402.async_unsupported",
  APPROVAL_NOT_FOUND: "approval.not_found",
  APPROVAL_FORBIDDEN: "approval.forbidden",
  APPROVAL_ACTION_HASH_MISMATCH: "approval.action_hash_mismatch",
  APPROVAL_ALREADY_CONSUMED: "approval.already_consumed",
  APPROVAL_INVALID_TOKEN: "approval.invalid_token",
  APPROVAL_PENDING: "approval.pending",
  APPROVAL_APPROVED: "approval.approved",
  APPROVAL_EXPIRED: "approval.expired",
  APPROVAL_DENIED: "approval.denied",
  RESOURCE_NOT_FOUND: "resource.not_found",
  INTERNAL_ERROR: "internal.error",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ProblemOptions {
  status: number;
  title: string;
  detail: string;
  code: ErrorCodeValue;
  retryable: boolean;
  type?: string;
  instance?: string;
  upgradeUrl?: string;
  [extension: string]: unknown;
}

/**
 * RFC 7807 `application/problem+json` response builder for billable endpoints.
 *
 * Agents consuming these endpoints depend on the machine-readable `code` and
 * `retryable` fields to decide whether to retry, back off, or surface an
 * upgrade hint to the user. The fields beyond the RFC 7807 core are extensions
 * and are ignored by clients that only parse the standard shape.
 */
export function problem(c: Context, opts: ProblemOptions): Response {
  const { status, title, detail, code, retryable, type, instance, upgradeUrl, ...rest } = opts;
  const body: Record<string, unknown> = {
    type: type ?? "about:blank",
    title,
    status,
    detail,
    instance: instance ?? c.req.path,
    code,
    retryable,
    ...rest,
  };
  if (upgradeUrl) body.upgradeUrl = upgradeUrl;
  return c.body(JSON.stringify(body), status as ContentfulStatusCode, {
    "Content-Type": "application/problem+json",
  });
}

export function isServiceDependencyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /DATABASE_URL environment variable is required/i.test(message)
    || /PrismaClientInitializationError/i.test(message)
    || /Can't reach database server/i.test(message)
    || /ECONNREFUSED|ETIMEDOUT|connection terminated unexpectedly/i.test(message);
}

export function dependencyUnavailableDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/DATABASE_URL environment variable is required/i.test(message)) {
    return "Database service is not configured: DATABASE_URL is required. Configure the database connection and retry.";
  }
  if (/redis/i.test(message)) {
    return "Required cache/rate-limit service is unavailable. Retry after the service recovers.";
  }
  return "Required persistence service is unavailable. Retry after the service recovers.";
}

export function serviceDependencyProblem(c: Context, err: unknown): Response {
  return problem(c, {
    status: 503,
    title: "Service unavailable",
    detail: dependencyUnavailableDetail(err),
    code: ErrorCode.SERVICE_UNAVAILABLE,
    retryable: true,
  });
}

export function jsonContentTypeProblem(c: Context): Response | null {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType || contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  return problem(c, {
    status: 400,
    title: "Validation failure",
    detail: "Content-Type must be application/json",
    code: ErrorCode.VALIDATION_INVALID_TYPE,
    retryable: false,
  });
}

