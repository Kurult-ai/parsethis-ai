import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { parsePrompt, analyzeOutputRisks, computeSuggestedAction, computeVerdict } from "../parse.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";
import type { AppEnv } from "../types.js";

export const mcpProxyRoutes = new Hono<AppEnv>();

// ─── MCP Tool Definitions ──────────────────────────────────────────────────

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_TOOLS: MCPTool[] = [
  {
    name: "screen_prompt",
    description:
      "Screen untrusted text before an AI agent passes it to an LLM, executes tools, stores memory, uses credentials, pays, runs code, shares private owner data, or shows the result to a user.",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", maxLength: 50000, description: "The text to screen for risks." },
        mode: {
          type: "string",
          enum: ["full", "pattern-only"],
          description: "Analysis mode. 'pattern-only' skips LLM analysis (privacy-sensitive).",
        },
        source: {
          type: "string",
          description: "Optional source label such as user_input, rag_document, tool_output, browser, email, or webhook.",
        },
        metadata: {
          type: "object",
          additionalProperties: true,
          properties: {
            agent_id: { type: "string" },
            session_id: { type: "string" },
            source_kind: {
              type: "string",
              enum: ["user", "colleague", "email", "retrieved_doc", "web_page", "tool_output", "memory", "agent_handoff"],
            },
            trust_level: { type: "string", enum: ["trusted", "untrusted", "external"] },
            intended_action: {
              type: "string",
              enum: ["summarize", "execute", "route", "reply", "extract"],
            },
            requester_trust: { type: "string", enum: ["unknown", "known", "trusted", "owner"] },
            requester_id: { type: "string" },
            channel: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "screen_output",
    description:
      "Screen LLM output before presenting it to users, storing it, or passing it to another tool or agent, including private disclosures that need owner approval.",
    inputSchema: {
      type: "object",
      required: ["output"],
      properties: {
        output: { type: "string", maxLength: 50000, description: "The LLM output text to screen." },
        context: {
          type: "string",
          description: "Optional original prompt or context for the output being screened.",
        },
        metadata: {
          type: "object",
          additionalProperties: true,
          properties: {
            requester_trust: { type: "string", enum: ["unknown", "known", "trusted", "owner"] },
            requester_id: { type: "string" },
            channel: { type: "string" },
          },
        },
      },
    },
  },
];

// ─── MCP JSON-RPC helpers ──────────────────────────────────────────────────

interface McpContentItem {
  type: "text";
  text: string;
}

function mcpToolResult(
  structuredContent: unknown,
  isError = false,
): { content: McpContentItem[]; structuredContent: unknown; isError?: boolean } {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function mcpToolError(message: string): { content: McpContentItem[]; isError: true } {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// ─── GET /v1/mcp/health ────────────────────────────────────────────────────

mcpProxyRoutes.get("/v1/mcp/health", (c) => {
  return c.json({
    status: "ok",
    protocol: "mcp",
    server: "parse-mcp-proxy",
    version: "1.0.0",
    tools: MCP_TOOLS.map((t) => t.name),
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /v1/mcp/tools/list ────────────────────────────────────────────────

mcpProxyRoutes.get("/v1/mcp/tools/list", authMiddleware("evaluate"), (c) => {
  return c.json({
    tools: MCP_TOOLS,
  });
});

// ─── POST /v1/mcp/tools/call ───────────────────────────────────────────────
//
// Implements the MCP tools/call method as a REST-style POST endpoint.
// The request body follows the MCP JSON-RPC params schema:
//   { "name": "<tool_name>", "arguments": { ... } }
// The response is an MCP-compliant CallToolResult:
//   { "content": [ { "type": "text", "text": "..." } ], "structuredContent": {...} }

mcpProxyRoutes.post(
  "/v1/mcp/tools/call",
  authMiddleware("evaluate"),
  billableUsageMiddleware(),
  async (c) => {
    const body = await c.req.json<{
      name?: string;
      arguments?: Record<string, unknown>;
    }>().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json(
        mcpToolError("Invalid request: body must be a JSON object."),
        400,
      );
    }

    const toolName = body.name;
    const args = body.arguments ?? {};

    if (!toolName || typeof toolName !== "string") {
      return c.json(
        mcpToolError("Missing or invalid 'name' field — must be a string tool name."),
        400,
      );
    }

    try {
      if (toolName === "screen_prompt") {
        return c.json(await handleScreenPrompt(args));
      }

      if (toolName === "screen_output") {
        return c.json(handleScreenOutput(args));
      }

      return c.json(
        mcpToolError(`Unknown tool: "${toolName}". Available tools: ${MCP_TOOLS.map((t) => t.name).join(", ")}.`),
        404,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid tool arguments";
      return c.json(mcpToolError(message), 400);
    }
  },
);

// ─── Tool handlers ─────────────────────────────────────────────────────────

async function handleScreenPrompt(args: Record<string, unknown>) {
  const prompt = requireString(args.prompt, "prompt");
  if (prompt.length > 50_000) {
    throw new Error("prompt must be 50,000 characters or less");
  }

  const result = await parsePrompt({
    prompt,
    execute: false,
    mode: args.mode === "pattern-only" || args.mode === "full" ? args.mode : undefined,
    metadata: {
      source: typeof args.source === "string" ? args.source : "mcp_proxy",
      ...(isRecord(args.metadata) ? args.metadata : {}),
    },
  });

  const structured = {
    tool: "screen_prompt",
    risk_score: result.risk_score,
    safe: result.safe,
    verdict: result.verdict,
    categories: result.categories,
    flags: result.flags,
    recommended_action: result.suggested_action ?? result.recommended_action ?? "allow",
    approval_request: result.approval_request,
    trace_id: result.id,
    analyzed_at: result.analyzed_at,
  };

  return mcpToolResult(structured);
}

function handleScreenOutput(args: Record<string, unknown>) {
  const output = requireString(args.output, "output");
  if (output.length > 50_000) {
    throw new Error("output must be 50,000 characters or less");
  }

  const context = typeof args.context === "string" ? args.context : "";
  const metadata = isRecord(args.metadata) ? args.metadata : undefined;

  const { outputFlags, outputRiskScore, approvalRequest } = analyzeOutputRisks(output, context, metadata as never);
  const action = computeSuggestedAction(outputRiskScore, approvalRequest);
  const categories = [...new Set(outputFlags.map((f) => f.category))];

  const structured = {
    tool: "screen_output",
    risk_score: outputRiskScore,
    safe: outputRiskScore <= 3,
    verdict: computeVerdict(outputRiskScore),
    categories,
    flags: outputFlags,
    recommended_action: action,
    approval_request: approvalRequest,
    output_length: output.length,
    analyzed_at: new Date().toISOString(),
  };

  return mcpToolResult(structured);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required and must be a non-empty string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
