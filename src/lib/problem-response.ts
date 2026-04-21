import type { Context } from "hono";

export const ErrorCode = {
  VALIDATION_REQUIRED: "validation.required",
  VALIDATION_TOO_LARGE: "validation.too_large",
  VALIDATION_INVALID_TYPE: "validation.invalid_type",
  AUTH_MISSING: "auth.missing",
  AUTH_INVALID: "auth.invalid",
  AUTH_EXPIRED: "auth.expired",
  AUTH_INSUFFICIENT_SCOPE: "auth.insufficient_scope",
  RATE_LIMIT: "rate_limit.exceeded",
  USAGE_CAP: "usage_cap.exceeded",
  PAYMENT_REQUIRED: "payment.required",
  UPSTREAM_UNAVAILABLE: "upstream.unavailable",
  SANDBOX_UNAVAILABLE: "sandbox.unavailable",
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}
