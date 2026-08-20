/**
 * Canonical Parse MCP tool set — the single source of truth for the hosted MCP
 * server (src/routes/mcp.ts) and for every page that names the tools or their
 * count (get-started, landing). Naming the count or the tool list anywhere else
 * drifts the moment a tool is added or removed: get_pricing shipped in May 2026
 * and /get-started still said "three tools" months later. Render from here.
 *
 * Covered by src/routes/mcp-tools-consistency.test.ts, which renders the pages
 * and asserts every MCP tool name appears and no stale count word does.
 */
export const MCP_TOOLS = [
  {
    name: "screen_prompt",
    description:
      "Screen untrusted text before an AI agent passes it to an LLM, executes tools, stores memory, uses credentials, pays, runs code, shares private owner data, or shows the result to a user.",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", maxLength: 50000 },
        source: { type: "string", description: "Optional source label such as user_input, rag_document, tool_output, browser, email, or webhook." },
        intended_action: { type: "string", description: "Optional description of the tool, memory, payment, or user-visible action this text may influence." },
        metadata: {
          type: "object",
          additionalProperties: true,
          properties: {
            requester_trust: { type: "string", enum: ["unknown", "known", "trusted", "owner"] },
            requester_id: { type: "string" },
            channel: { type: "string" },
            subject: { type: "string" },
            conversation_context: { type: "string" },
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
        output: { type: "string", maxLength: 50000 },
        context: { type: "string" },
        metadata: {
          type: "object",
          additionalProperties: true,
          properties: {
            requester_trust: { type: "string", enum: ["unknown", "known", "trusted", "owner"] },
            requester_id: { type: "string" },
            channel: { type: "string" },
            subject: { type: "string" },
            conversation_context: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "verify_agent_trust",
    description:
      "Verify peer-agent messages for prompt injection, spoofing, social engineering, sensitive-data exfiltration, and malicious intent.",
    inputSchema: {
      type: "object",
      required: ["source_agent", "message"],
      properties: {
        source_agent: { type: "string" },
        message: { type: "string", maxLength: 50000 },
        context: { type: "string" },
        metadata: { type: "object", additionalProperties: true },
      },
    },
  },
  {
    name: "get_pricing",
    description:
      "Return x402 prices, payment network, pricing URL, OpenAPI URL, docs URL, MCP manifest URL, and hosted MCP endpoint.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

/** Every tool name the hosted MCP server exposes via tools/list, in order. */
export const MCP_TOOL_NAMES: readonly string[] = MCP_TOOLS.map((t) => t.name);

/** The screening tools (everything except the get_pricing utility). */
export const MCP_SCREENING_TOOL_NAMES: readonly string[] = MCP_TOOLS.filter(
  (t) => t.name !== "get_pricing",
).map((t) => t.name);

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten",
];

/** Spell a small cardinal so copy reads "four tools", not "4 tools". */
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}
