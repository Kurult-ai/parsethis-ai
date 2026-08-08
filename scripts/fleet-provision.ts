#!/usr/bin/env node
/**
 * Fleet Provisioning CLI
 *
 * Registers multiple AI agents at once from a YAML or JSON config file.
 *
 * Usage:
 *   npm run fleet-provision -- --config fleet.yaml
 *   npm run fleet-provision -- --config fleet.json --base-url http://localhost:3000 --api-key sk_live_xxx
 *
 * Config format (fleet.yaml or fleet.json):
 *   agents:
 *     - agent_id: research-agent-1          # optional — used in metadata
 *       name: Research Agent                 # required
 *       environment: production              # optional, default: production
 *       framework: langchain                 # optional
 *       description: "..."                   # optional
 *       risk_level: medium                   # optional
 *       owner: team@company.com             # optional
 *       tools: [web_search, web_fetch]       # optional
 *       data_access: [public, internal]      # optional
 *       policy_pack: enterprise-standard     # optional — apply this policy pack after registration
 *       data_sources:                        # optional — data source IDs to grant access to
 *         - source_id_1
 *         - source_id_2
 *       data_grants:                         # optional — explicit grants with access level
 *         - data_source_id: source_id_1
 *           access: read
 *
 * Output:
 *   A summary JSON with agents registered, grants created, and any errors.
 */

import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { argv, exit } from "node:process";

// ─── Types ────────────────────────────────────────────────────────────────

interface FleetAgentConfig {
  agent_id?: string;
  name: string;
  environment?: string;
  framework?: string;
  description?: string;
  risk_level?: string;
  owner?: string;
  tools?: string[];
  data_access?: string[];
  policy_pack?: string;
  data_sources?: string[];
  data_grants?: Array<{
    data_source_id: string;
    access?: string;
  }>;
}

interface FleetConfig {
  agents: FleetAgentConfig[];
}

interface ProvisionResult {
  agent_id: string | null;
  agent_name: string;
  registered: boolean;
  agent_db_id: string | null;
  policy_pack_applied: boolean | null;
  grants_created: number;
  errors: string[];
}

interface FleetSummary {
  total_agents: number;
  agents_registered: number;
  grants_created: number;
  policy_packs_applied: number;
  errors: string[];
  results: ProvisionResult[];
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

// ─── Config Parsing ───────────────────────────────────────────────────────

function parseArgs(args: string[]): { configPath: string; baseUrl: string; apiKey: string | null } {
  let configPath: string | null = null;
  let baseUrl: string | null = null;
  let apiKey: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && i + 1 < args.length) {
      configPath = args[i + 1];
      i++;
    } else if (args[i] === "--base-url" && i + 1 < args.length) {
      baseUrl = args[i + 1];
      i++;
    } else if (args[i] === "--api-key" && i + 1 < args.length) {
      apiKey = args[i + 1];
      i++;
    } else if (args[i].startsWith("--config=")) {
      configPath = args[i].split("=")[1];
    } else if (args[i].startsWith("--base-url=")) {
      baseUrl = args[i].split("=")[1];
    } else if (args[i].startsWith("--api-key=")) {
      apiKey = args[i].split("=")[1];
    }
  }

  if (!configPath) {
    console.error("Error: --config is required. Usage: npm run fleet-provision -- --config fleet.yaml [--base-url URL] [--api-key KEY]");
    exit(1);
  }

  return {
    configPath,
    baseUrl: baseUrl ?? process.env.PARSE_BASE_URL ?? "http://localhost:3000",
    apiKey: apiKey ?? (process.env.PARSE_API_KEY ?? null),
  };
}

function loadConfig(path: string): FleetConfig {
  if (!existsSync(path)) {
    console.error(`Error: Config file not found: ${path}`);
    exit(1);
  }

  const raw = readFileSync(path, "utf-8");
  const ext = extname(path).toLowerCase();

  if (ext === ".json") {
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.error(`Error: Failed to parse JSON config: ${(err as Error).message}`);
      exit(1);
    }
  }

  if (ext === ".yaml" || ext === ".yml") {
    try {
      const yaml = require("js-yaml");
      const config = yaml.load(raw);
      if (!config || typeof config !== "object") {
        console.error("Error: YAML config is empty or invalid");
        exit(1);
      }
      return config as FleetConfig;
    } catch (err) {
      console.error(`Error: Failed to parse YAML config: ${(err as Error).message}`);
      exit(1);
    }
  }

  console.error(`Error: Unsupported config format: ${ext}. Use .yaml, .yml, or .json`);
  exit(1);
}

// ─── API Client ───────────────────────────────────────────────────────────

async function apiCall(
  baseUrl: string,
  method: string,
  path: string,
  apiKey: string | null,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data: unknown = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: { error: `Network error: ${(err as Error).message}` },
    };
  }
}

// ─── Agent Provisioning ───────────────────────────────────────────────────

async function provisionAgent(
  agentConfig: FleetAgentConfig,
  baseUrl: string,
  apiKey: string | null,
): Promise<ProvisionResult> {
  const result: ProvisionResult = {
    agent_id: agentConfig.agent_id ?? null,
    agent_name: agentConfig.name,
    registered: false,
    agent_db_id: null,
    policy_pack_applied: null,
    grants_created: 0,
    errors: [],
  };

  // Step 1: Register the agent
  const registerBody: Record<string, unknown> = {
    name: agentConfig.name,
  };
  if (agentConfig.framework) registerBody.framework = agentConfig.framework;
  if (agentConfig.description) registerBody.description = agentConfig.description;
  if (agentConfig.risk_level) registerBody.riskLevel = agentConfig.risk_level;
  if (agentConfig.owner) registerBody.owner = agentConfig.owner;
  if (agentConfig.tools) registerBody.tools = agentConfig.tools;
  if (agentConfig.data_access) registerBody.dataAccess = agentConfig.data_access;
  if (agentConfig.agent_id) registerBody.metadata = { agent_id: agentConfig.agent_id };

  const regResponse = await apiCall(
    baseUrl,
    "POST",
    "/v1/agents/register",
    apiKey,
    registerBody,
  );

  if (!regResponse.ok) {
    const errMsg = (regResponse.data as Record<string, unknown>)?.detail
      ?? (regResponse.data as Record<string, unknown>)?.error
      ?? `HTTP ${regResponse.status}`;
    result.errors.push(`Registration failed: ${errMsg}`);
    return result;
  }

  result.registered = true;
  const agentData = regResponse.data as Record<string, unknown>;
  result.agent_db_id = (agentData.id as string) ?? null;

  // Step 2: Apply policy pack if specified
  if (agentConfig.policy_pack) {
    const applyBody: Record<string, unknown> = {
      environment: agentConfig.environment ?? "production",
    };

    const applyResponse = await apiCall(
      baseUrl,
      "POST",
      `/v1/policy-packs/${agentConfig.policy_pack}/apply`,
      apiKey,
      applyBody,
    );

    if (!applyResponse.ok) {
      const errMsg = (applyResponse.data as Record<string, unknown>)?.detail
        ?? (applyResponse.data as Record<string, unknown>)?.error
        ?? `HTTP ${applyResponse.status}`;
      result.errors.push(`Policy pack "${agentConfig.policy_pack}" apply failed: ${errMsg}`);
      result.policy_pack_applied = false;
    } else {
      result.policy_pack_applied = true;
    }
  }

  // Step 3: Create data grants
  // From data_sources (simple list — all get "read" access)
  if (agentConfig.data_sources && agentConfig.data_sources.length > 0 && result.agent_db_id) {
    for (const sourceId of agentConfig.data_sources) {
      const grantResponse = await apiCall(
        baseUrl,
        "POST",
        `/v1/agents/${result.agent_db_id}/grants`,
        apiKey,
        {
          data_source_id: sourceId,
          access: "read",
        },
      );

      if (grantResponse.ok) {
        result.grants_created++;
      } else {
        const errMsg = (grantResponse.data as Record<string, unknown>)?.detail
          ?? (grantResponse.data as Record<string, unknown>)?.error
          ?? `HTTP ${grantResponse.status}`;
        result.errors.push(`Grant for data source "${sourceId}" failed: ${errMsg}`);
      }
    }
  }

  // From explicit data_grants (with access level)
  if (agentConfig.data_grants && agentConfig.data_grants.length > 0 && result.agent_db_id) {
    for (const grant of agentConfig.data_grants) {
      const grantResponse = await apiCall(
        baseUrl,
        "POST",
        `/v1/agents/${result.agent_db_id}/grants`,
        apiKey,
        {
          data_source_id: grant.data_source_id,
          access: grant.access ?? "read",
        },
      );

      if (grantResponse.ok) {
        result.grants_created++;
      } else {
        const errMsg = (grantResponse.data as Record<string, unknown>)?.detail
          ?? (grantResponse.data as Record<string, unknown>)?.error
          ?? `HTTP ${grantResponse.status}`;
        result.errors.push(`Grant for data source "${grant.data_source_id}" failed: ${errMsg}`);
      }
    }
  }

  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { configPath, baseUrl, apiKey } = parseArgs(argv.slice(2));

  if (!apiKey) {
    console.error("Error: API key required. Set PARSE_API_KEY env var or pass --api-key.");
    exit(1);
  }

  console.log(`\n🚀 Fleet Provisioning CLI`);
  console.log(`   Config: ${resolve(configPath)}`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log("");

  const config = loadConfig(configPath);

  if (!config.agents || !Array.isArray(config.agents) || config.agents.length === 0) {
    console.error("Error: Config must contain an 'agents' array with at least one agent definition.");
    exit(1);
  }

  const startedAt = new Date();
  const results: ProvisionResult[] = [];
  const allErrors: string[] = [];

  for (let i = 0; i < config.agents.length; i++) {
    const agentConfig = config.agents[i];
    console.log(`  [${i + 1}/${config.agents.length}] Provisioning "${agentConfig.name}"...`);

    const result = await provisionAgent(agentConfig, baseUrl, apiKey);
    results.push(result);
    allErrors.push(...result.errors.map((e) => `[${agentConfig.name}] ${e}`));

    if (result.registered) {
      const grantsInfo = result.grants_created > 0 ? `, ${result.grants_created} grants` : "";
      const packInfo = result.policy_pack_applied ? `, pack applied` : "";
      console.log(`    ✅ Registered${grantsInfo}${packInfo}`);
    } else {
      console.log(`    ❌ Failed: ${result.errors.join("; ")}`);
    }
  }

  const completedAt = new Date();
  const summary: FleetSummary = {
    total_agents: config.agents.length,
    agents_registered: results.filter((r) => r.registered).length,
    grants_created: results.reduce((sum, r) => sum + r.grants_created, 0),
    policy_packs_applied: results.filter((r) => r.policy_pack_applied === true).length,
    errors: allErrors,
    results,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - startedAt.getTime(),
  };

  console.log("");
  console.log(`── Summary ────────────────────────────────`);
  console.log(`  Agents registered: ${summary.agents_registered}/${summary.total_agents}`);
  console.log(`  Grants created:    ${summary.grants_created}`);
  console.log(`  Policy packs:      ${summary.policy_packs_applied}`);
  console.log(`  Errors:            ${summary.errors.length}`);
  console.log(`  Duration:          ${summary.duration_ms}ms`);
  if (summary.errors.length > 0) {
    console.log("");
    console.log(`  Errors:`);
    for (const err of summary.errors) {
      console.log(`    - ${err}`);
    }
  }
  console.log("");
  console.log("Full summary (JSON):");
  console.log(JSON.stringify(summary, null, 2));

  // Exit with non-zero if any errors
  if (summary.errors.length > 0) {
    exit(1);
  }
}

// Run if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    exit(1);
  });
}
