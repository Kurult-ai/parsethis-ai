import { Hono } from "hono";
import { HELD_DISPOSITIONS } from "../lib/held-dispositions.js";
import { prisma } from "../db.js";
import { authMiddleware } from "../auth.js";
import { buildDigest } from "../lib/digest.js";
import type { AppEnv } from "../types.js";
import { peekDeepScreening } from "../lib/model-budget.js";

/**
 * GET /v1/activity — "is Parse actually running?"
 *
 * Prospect run 14 followed the install page's Hermes tab, ran three commands
 * that each printed a success tick, and installed nothing at all. The only
 * thing in the whole product that could have caught it was one sentence —
 * "watch your agents check in on the dashboard" — which nothing asked him to
 * act on, and which pointed at a page whose empty state is indistinguishable
 * from a working install with no traffic yet.
 *
 * This is the endpoint that answers the question directly, for any valid key:
 * has this key screened anything, and recently? Three states, named rather than
 * left to inference:
 *
 *   never      — nothing has ever arrived. The install is not working.
 *   stopped    — it worked once and has gone quiet.
 *   screening  — traffic is arriving now.
 *
 * Deliberately **not** role-gated. `/v1/compliance/summary` carries
 * `requireRole("org_admin", "security_analyst", "auditor")`, so a fresh
 * self-service key that belongs to no org cannot read it — which is precisely
 * the caller who most needs to know whether their install works. This route
 * scopes to the caller's own key and nothing else, so there is nothing for a
 * role to protect.
 */

export const activityRoutes = new Hono<AppEnv>();

/** Traffic seen inside this window means the install is live right now. */
const LIVE_WINDOW_HOURS = 24;

/** Beyond this, an install that once worked has plainly stopped. */
const STOPPED_AFTER_HOURS = 48;

export type ActivityStatus = "never" | "stopped" | "screening";

/**
 * Pure so the three-state rule is testable without a database. `lastAt` is the
 * most recent screening for this key, `now` is injected for the same reason.
 */
export function classifyActivity(
  total: number,
  lastAt: Date | null,
  now: Date,
): { status: ActivityStatus; hoursSinceLast: number | null } {
  if (total === 0 || !lastAt) return { status: "never", hoursSinceLast: null };
  const hours = (now.getTime() - lastAt.getTime()) / 3_600_000;
  return { status: hours > STOPPED_AFTER_HOURS ? "stopped" : "screening", hoursSinceLast: hours };
}

function message(status: ActivityStatus, total: number, recent: number, hours: number | null): string {
  if (status === "never") {
    return "Parse has never been called with this key. Your key is valid — your agent is not using it. "
      + "Re-run the install snippet for your runtime, check that its confirm command listed the Parse "
      + "tools, and restart your agent after changing its configuration.";
  }
  if (status === "stopped") {
    const days = Math.floor((hours ?? 0) / 24);
    return `Parse screened ${total.toLocaleString("en-US")} prompts for this key, but nothing in the last `
      + `${days} day${days === 1 ? "" : "s"}. If your agent is still running, it has stopped calling Parse.`;
  }
  return `Parse is screening for this key — ${recent.toLocaleString("en-US")} in the last `
    + `${LIVE_WINDOW_HOURS} hours, ${total.toLocaleString("en-US")} in total.`;
}

activityRoutes.get("/v1/activity", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const now = new Date();
  const since = new Date(now.getTime() - LIVE_WINDOW_HOURS * 3_600_000);

  let total = 0;
  let recent = 0;
  let held = 0;
  let lastAt: Date | null = null;

  // Each read is independently guarded: a degraded database should answer
  // "cannot tell" rather than 500 on the page a stuck customer is reading.
  try {
    const scope = { apiKeyId: apiKey.id };
    const [totalCount, recentCount, heldCount, latest] = await Promise.all([
      prisma.screeningEvent.count({ where: scope }),
      prisma.screeningEvent.count({ where: { ...scope, createdAt: { gte: since } } }),
      // The holds. Counted over the same window as `screened_last_24h`, because
      // "what is waiting for me" is a question about now, not about all time.
      prisma.screeningEvent.count({
        where: { ...scope, createdAt: { gte: since }, disposition: { in: [...HELD_DISPOSITIONS] } },
      }),
      prisma.screeningEvent.findFirst({
        where: scope,
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    total = totalCount;
    recent = recentCount;
    held = heldCount;
    lastAt = latest?.createdAt ?? null;
  } catch {
    return c.json({
      status: "unknown",
      detail: "Screening history is unavailable right now, so this cannot confirm your install. Try again shortly.",
    }, 200);
  }

  const { status, hoursSinceLast } = classifyActivity(total, lastAt, now);

  // The unattended agent's other silent failure. A free key renews while it is
  // in use and expires after an idle period, failing closed with a 401 — so the
  // agent that quietly stopped calling Parse is also the agent whose key is
  // running down. Both facts belong in the same answer.
  const expiresInDays = c.get("apiKey").expires_in_days;
  const keyWarning =
    typeof expiresInDays === "number" && expiresInDays <= 7
      ? `This key expires in ${expiresInDays} day${expiresInDays === 1 ? "" : "s"} and then fails closed with a 401. `
        + "It renews automatically whenever it is used, so a screening call before then is enough; "
        + "Solo removes idle expiry altogether."
      : undefined;

  // Run 32/33 (P2-3): per-trace rows. "Confirm it is on" is a get-started
  // step, but the evaluation needs to SEE the last screens — trace id,
  // verdict, mode, latency, when. Aggregates stay (they answer "is it
  // alive"); rows answer "what did it do". Last 50, key-scoped, no prompt
  // text (ScreeningEvent does not store it — see /v1/explain for why).
  let recentRows: Array<{
    trace_id: string;
    verdict: string;
    mode: string;
    latency_ms: number;
    disposition: string | null;
    created_at: string;
  }> = [];
  try {
    const rows = await prisma.screeningEvent.findMany({
      where: { apiKeyId: apiKey.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, verdict: true, mode: true, latencyMs: true,
        disposition: true, createdAt: true,
      },
    });
    recentRows = rows.map((r) => ({
      trace_id: r.id,
      verdict: r.verdict,
      mode: r.mode,
      latency_ms: r.latencyMs,
      disposition: r.disposition ?? null,
      created_at: r.createdAt.toISOString(),
    }));
  } catch {
    // Rows are additive; the aggregate answer below still stands alone.
  }

  // Which layer is actually running. Run 18: a free key past its 50/day deep
  // budget ran pattern-only for the rest of the evening while this endpoint
  // said "Parse is screening for this key" — true, and useless. The response
  // body knew; the surface a person reads did not. Deliberately not keyed on
  // the `degraded` flag: budget exhaustion sets degraded null, not true, so a
  // degraded-only check misses the commonest cause of the same downgrade.
  const budget = await peekDeepScreening(c.get("apiKey").id, c.get("apiKey").tier ?? "free")
    .catch(() => null);
  const deepWarning = budget?.spent
    ? `Deep screening for this key is spent for the ${budget.window} (${budget.used} of ${budget.limit}). `
      + "Instant screening is still running and still blocks what it catches, but paraphrased and "
      + "indirect attacks are not being checked until the window rolls. See /pricing to raise it."
    : undefined;

  return c.json({
    status,
    screened_total: total,
    screened_last_24h: recent,
    // What is waiting on a person. Prospect run 24 walked a hold to its end and
    // found that nothing a customer reads could report one: `refused` and
    // `reported` were both here, and the disposition that needs them was not.
    held_last_24h: held,
    last_screened_at: lastAt ? lastAt.toISOString() : null,
    recent: recentRows,
    message: message(status, total, recent, hoursSinceLast),
    ...(held > 0
      ? {
        held_note: `${held} screening${held === 1 ? "" : "s"} in the last 24 hours ${held === 1 ? "was" : "were"} `
          + "held rather than decided — Parse did not choose for you, and nothing has told the sender. "
          + "To put a blocked action in front of the owner instead of failing closed, send `hold: \"approve\"` "
          + "on the screen (or set hold_for_approval on the policy): the block returns 202 with an approval "
          + "request the owner can approve or deny, default-deny on expiry.",
      }
      : {}),
    ...(budget
      ? {
        deep_screening: {
          used: budget.used,
          included: budget.limit,
          remaining: Math.max(0, budget.limit - budget.used),
          window: budget.window,
          spent: budget.spent,
        },
      }
      : {}),
    ...(deepWarning ? { deep_screening_warning: deepWarning } : {}),
    ...(typeof expiresInDays === "number" ? { key_expires_in_days: expiresInDays } : {}),
    ...(keyWarning ? { key_warning: keyWarning } : {}),
    ...(status === "never"
      ? {
        _help: {
          install: "/get-started",
          detail: "A configuration command that printed a success line is not evidence that anything is calling Parse.",
        },
      }
      : {}),
  });
});

/**
 * GET /v1/digest — the month's receipt for this key.
 *
 * The counting rules live in `lib/digest.ts` and are pure; this route is the
 * database read and nothing else. Key-scoped, which for a single-owner agent is
 * exactly right and is not the org-scoping bug run 11 found — there is no org
 * here to scope to.
 */
activityRoutes.get("/v1/digest", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - monthStart.getTime()) / 86_400_000));

  try {
    const events = await prisma.screeningEvent.findMany({
      where: { apiKeyId: apiKey.id, createdAt: { gte: monthStart } },
      select: { riskScore: true, verdict: true, categories: true, blocked: true, disposition: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10_000,
    });
    // Same reason as /v1/activity above: the receipt a person reads must say
    // when part of the month ran without the semantic layer. Run 18's digest
    // said "screened 99 and refused 37" with no hint that the deep budget had
    // been spent hours earlier.
    const digest = buildDigest(events, period, daysElapsed);
    const budget = await peekDeepScreening(apiKey.id, apiKey.tier ?? "free").catch(() => null);
    return c.json({
      ...digest,
      ...(budget
        ? {
          deep_screening: {
            used: budget.used,
            included: budget.limit,
            remaining: Math.max(0, budget.limit - budget.used),
            window: budget.window,
            spent: budget.spent,
            ...(budget.spent
              ? {
                note:
                  `Deep screening is spent for this ${budget.window}, so some of what your agent read was `
                  + "checked by instant screening alone — that still blocks what it catches, but it does not "
                  + "catch paraphrased or indirect attacks.",
              }
              : {}),
          },
        }
        : {}),
    });
  } catch {
    return c.json({
      period,
      detail: "Screening history is unavailable right now. Try again shortly.",
    }, 200);
  }
});
