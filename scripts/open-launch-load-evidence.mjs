#!/usr/bin/env node
/**
 * Sustained live evidence runner for Parse open-launch readiness.
 *
 * This is intentionally separate from beta:sentinel. It can generate traffic against
 * production, so keep defaults modest and require explicit duration/concurrency.
 *
 * Examples:
 *   node scripts/open-launch-load-evidence.mjs --dry-run
 *   PARSE_API_KEYS=pfa_live_...,pfa_live_... node scripts/open-launch-load-evidence.mjs --duration-seconds=1800 --concurrency=8 --out docs/qa/open-launch-load-$(date -u +%Y%m%dT%H%M%SZ).json
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PARSE_BASE_URL || "https://www.parsethis.ai",
    durationSeconds: 60,
    concurrency: 2,
    intervalMs: 250,
    out: "",
    dryRun: false,
    allowKeygen: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--allow-keygen") args.allowKeygen = true;
    else if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--duration-seconds=")) args.durationSeconds = Number(arg.slice("--duration-seconds=".length));
    else if (arg.startsWith("--concurrency=")) args.concurrency = Number(arg.slice("--concurrency=".length));
    else if (arg.startsWith("--interval-ms=")) args.intervalMs = Number(arg.slice("--interval-ms=".length));
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.durationSeconds) || args.durationSeconds < 1) throw new Error("--duration-seconds must be >= 1");
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) throw new Error("--concurrency must be >= 1");
  if (!Number.isFinite(args.intervalMs) || args.intervalMs < 0) throw new Error("--interval-ms must be >= 0");
  return args;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function redact(value) {
  return String(value ?? "").replace(/pfa_(live|test)_[A-Za-z0-9_-]+/g, "pfa_$1_[REDACTED]");
}

function summarize(results) {
  const statusCounts = {};
  const codeCounts = {};
  const endpointCounts = {};
  const latencies = [];
  const unexpected = [];

  for (const result of results) {
    statusCounts[String(result.status)] = (statusCounts[String(result.status)] || 0) + 1;
    endpointCounts[result.endpoint] = (endpointCounts[result.endpoint] || 0) + 1;
    if (result.code) codeCounts[result.code] = (codeCounts[result.code] || 0) + 1;
    if (Number.isFinite(result.ms)) latencies.push(result.ms);
    if (![200, 429].includes(result.status)) unexpected.push(result);
  }

  return {
    total_requests: results.length,
    status_counts: statusCounts,
    code_counts: codeCounts,
    endpoint_counts: endpointCounts,
    unexpected_counts: {
      unexpected_401: results.filter((r) => r.status === 401).length,
      unexpected_5xx: results.filter((r) => typeof r.status === "number" && r.status >= 500).length,
      network: results.filter((r) => r.status === "network").length,
    },
    latency_ms: {
      min: latencies.length ? Math.min(...latencies) : null,
      p50: percentile(latencies, 0.5),
      p90: percentile(latencies, 0.9),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.length ? Math.max(...latencies) : null,
    },
    sample_unexpected: unexpected.slice(0, 20).map((item) => ({ ...item, detail: redact(item.detail), raw: redact(item.raw) })),
  };
}

async function postJson(baseUrl, path, apiKey, body) {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let parsed = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw: raw.slice(0, 500) }; }
    return {
      endpoint: path,
      status: res.status,
      ms: Date.now() - started,
      code: parsed.code,
      title: parsed.title,
      detail: parsed.detail,
      raw: parsed.raw,
    };
  } catch (error) {
    return { endpoint: path, status: "network", ms: Date.now() - started, error: String(error) };
  }
}

async function generateKey(baseUrl) {
  const res = await fetch(`${baseUrl}/v1/keys/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `open-launch-evidence-${Date.now()}` }),
  });
  const body = await res.json();
  if (res.status !== 201 || !body.key) throw new Error(`keygen failed: HTTP ${res.status} ${redact(JSON.stringify(body))}`);
  return body.key;
}

function nextPayload(iteration) {
  const mod = iteration % 3;
  if (mod === 0) {
    return ["/v1/parse", {
      prompt: `Open-launch evidence benign prompt ${iteration}: summarize deployment notes without tool use.`,
      mode: "pattern-only",
      execute: false,
      metadata: { source: "load_evidence", iteration },
    }];
  }
  if (mod === 1) {
    return ["/v1/screen-output", {
      output: `Safe beta support answer ${iteration}: explain that rate limits may return HTTP 429.`,
      context: { source: "load_evidence", original_prompt: "support response draft", iteration },
    }];
  }
  return ["/v1/agent/trust/verify", {
    message: `Peer agent ${iteration} asks for a routine docs handoff, no credentials requested.`,
    source_agent: `load-evidence-agent-${iteration % 5}`,
    context: "routine peer delegation smoke",
  }];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let keys = (process.env.PARSE_API_KEYS || process.env.PARSE_API_KEY || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  const plan = {
    service: "parse-open-launch-load-evidence",
    base_url: args.baseUrl,
    duration_seconds: args.durationSeconds,
    concurrency: args.concurrency,
    interval_ms: args.intervalMs,
    supplied_key_count: keys.length,
    allow_keygen: args.allowKeygen,
    dry_run: args.dryRun,
    warning: "This runner can generate production traffic. It is evidence tooling, not proof by itself.",
  };

  if (args.dryRun) {
    console.log(JSON.stringify({ ...plan, status: "DRY_RUN", would_run_requests_approximately: Math.ceil(args.durationSeconds * args.concurrency * 1000 / Math.max(1, args.intervalMs || 1)) }, null, 2));
    return;
  }

  if (!keys.length && args.allowKeygen) {
    keys = [await generateKey(args.baseUrl)];
  }
  if (!keys.length) {
    throw new Error("Set PARSE_API_KEYS or PARSE_API_KEY, or pass --allow-keygen for a short generated-key run.");
  }

  const deadline = Date.now() + args.durationSeconds * 1000;
  const results = [];
  let iteration = 0;

  async function worker(workerId) {
    while (Date.now() < deadline) {
      const current = iteration++;
      const [path, body] = nextPayload(current);
      const key = keys[(workerId + current) % keys.length];
      results.push(await postJson(args.baseUrl, path, key, body));
      if (args.intervalMs) await sleep(args.intervalMs);
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, (_, workerId) => worker(workerId)));

  const report = {
    ...plan,
    status: "COMPLETE",
    started_at: new Date(Date.now() - args.durationSeconds * 1000).toISOString(),
    finished_at: new Date().toISOString(),
    key_count: keys.length,
    summary: summarize(results),
    acceptance_hint: {
      controlled_beta_expected: "0 unexpected 401, 0 unexpected 5xx/network, 429 only where plan limits are intentionally exceeded",
      open_launch_expected: "Run a separate 30-60 minute multi-key test and inspect p95/p99, dependency stability, and error samples before claiming broad launch readiness.",
    },
  };

  const rendered = JSON.stringify(report, null, 2);
  if (args.out) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, rendered + "\n");
  }
  console.log(rendered);

  const bad = report.summary.unexpected_counts.unexpected_401 > 0 || report.summary.unexpected_counts.unexpected_5xx > 0 || report.summary.unexpected_counts.network > 0;
  if (bad) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "ERROR", message: redact(error.message), stack: process.env.DEBUG ? error.stack : undefined }, null, 2));
  process.exit(1);
});
