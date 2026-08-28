/**
 * Shareable Evidence Report — GET /report/:id
 *
 * The forwardable artifact. An agency pastes an attack-pack sample (or their
 * own text via the demo console), screening stores a verdict snapshot in Redis
 * (7-day TTL from src/lib/report-ttl.ts, unguessable 24-hex id), and this
 * route renders it in CISO language: what was found, what an unscreened agent
 * would have executed, a provenance block, and the validity strip stating
 * exactly when the link expires.
 *
 * Rendering lives in src/pages/evidence-report.ts (pure, testable without
 * Redis). Past the 7-day horizon — or for an id that was never issued, which
 * is indistinguishable — the same route serves the regeneration page pointing
 * back at /attack and /demo.
 */

import { Hono } from "hono";
import { loadReport } from "./attack-pack.js";
import {
  renderEvidenceReportPage,
  renderReportUnavailablePage,
} from "../pages/evidence-report.js";
import type { AppEnv } from "../types.js";

export const reportRoutes = new Hono<AppEnv>();

reportRoutes.get("/report/:id", async (c) => {
  const id = c.req.param("id");
  const baseUrl = c.req.header("x-forwarded-proto")
    ? `${c.req.header("x-forwarded-proto")}://${c.req.header("host")}`
    : process.env.PUBLIC_BASE_URL || "https://www.parsethis.ai";

  const report = await loadReport(id);
  if (!report) {
    return c.html(renderReportUnavailablePage({ id, baseUrl }), 404);
  }
  return c.html(renderEvidenceReportPage({ report, id, baseUrl }));
});
