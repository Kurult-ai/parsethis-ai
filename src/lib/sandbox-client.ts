import { createHmac, randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentConfig {
  model: string;          // required: e.g., "anthropic/claude-sonnet-4-6"
  temperature?: number;   // default 0.7
  max_tokens?: number;    // default 2048
  agent_role?: string;    // optional: "customer service agent" (NOT system_prompt)
}

export interface SandboxResult {
  output: string;
  token_usage: { prompt: number; completion: number; total: number };
  model_used: string;
  execution_ms: number;
}

export type SandboxOutcome =
  | { status: "executed"; isolated: true; result: SandboxResult }
  | { status: "fallback"; isolated: false; result: SandboxResult }
  | { status: "unavailable"; isolated: false; result: null };

// ─── Environment Checks ────────────────────────────────────────────────────

export function canUseSandbox(): boolean {
  return !!(process.env.SANDBOX_URL && process.env.SANDBOX_HMAC_SECRET);
}

export function isFallbackAllowed(): boolean {
  return process.env.ALLOW_UNISOLATED_EXECUTION === "true";
}

// ─── HMAC Signing ──────────────────────────────────────────────────────────

function signRequest(body: string, timestamp: string, nonce: string): string {
  const payload = `${body}\n${timestamp}\n${nonce}`;
  return createHmac("sha256", process.env.SANDBOX_HMAC_SECRET!)
    .update(payload)
    .digest("hex");
}

// ─── Sandbox Execution ─────────────────────────────────────────────────────

export async function executeInSandbox(
  prompt: string,
  testInput: string | undefined,
  agentConfig: AgentConfig
): Promise<SandboxResult> {
  const sandboxUrl = process.env.SANDBOX_URL!;

  // Build messages array
  const messages: Array<{ role: string; content: string }> = [];

  // Use agent_role to construct a generic system message (NOT the agent's actual system prompt)
  if (agentConfig.agent_role) {
    messages.push({
      role: "system",
      content: `You are a ${agentConfig.agent_role}.`,
    });
  }

  if (testInput) {
    messages.push({ role: "system", content: prompt });
    messages.push({ role: "user", content: testInput });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const requestBody = JSON.stringify({
    messages,
    model: agentConfig.model,
    temperature: agentConfig.temperature ?? 0.7,
    max_tokens: agentConfig.max_tokens ?? 2048,
    timeout_ms: 90_000, // 90s for sandbox execution
  });

  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const signature = signRequest(requestBody, timestamp, nonce);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 100_000); // 100s total

  try {
    const res = await fetch(`${sandboxUrl}/v1/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sandbox-Timestamp": timestamp,
        "X-Sandbox-Nonce": nonce,
        "X-Sandbox-Signature": signature,
        "X-Sandbox-Protocol": "1",
      },
      body: requestBody,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Sandbox error ${res.status}: ${errText}`);
    }

    return await res.json() as SandboxResult;
  } finally {
    clearTimeout(timeout);
  }
}
