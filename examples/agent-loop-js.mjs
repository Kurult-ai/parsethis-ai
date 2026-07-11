#!/usr/bin/env node
/**
 * Parse for Agents: minimal JS/TS agent-loop integration.
 *
 * Usage:
 *   PARSE_API_KEY=pfa_live_... node examples/agent-loop-js.mjs
 *
 * Optional:
 *   PARSE_BASE_URL=https://www.parsethis.ai node examples/agent-loop-js.mjs
 */

const BASE_URL = process.env.PARSE_BASE_URL || "https://www.parsethis.ai";
const API_KEY = process.env.PARSE_API_KEY;

if (!API_KEY) {
  console.error("Set PARSE_API_KEY first. Example: PARSE_API_KEY=pfa_live_... node examples/agent-loop-js.mjs");
  process.exit(2);
}

async function parseFetch(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const retryable = res.status === 429 || res.status === 503;
    const error = new Error(`Parse ${path} failed with HTTP ${res.status}`);
    error.status = res.status;
    error.retryable = retryable;
    error.body = json;
    throw error;
  }

  return json;
}

function shouldBlockParseResult(result) {
  const riskScore = result.risk_score ?? result.riskScore ?? result.score ?? 0;
  const action = result.recommended_action || result.suggested_action || result.decision?.action;
  return result.safe === false || riskScore >= 7 || ["block", "deny", "refuse"].includes(String(action || "").toLowerCase());
}

async function screenUntrustedInput(prompt) {
  const result = await parseFetch("/v1/parse", {
    prompt,
    mode: "pattern-only",
    execute: false,
    metadata: {
      source: "user_input",
      requester_trust: "unknown",
      integration: "examples/agent-loop-js.mjs",
    },
  });

  if (shouldBlockParseResult(result)) {
    return { allowed: false, reason: "Parse flagged the input", result };
  }

  return { allowed: true, result };
}

async function screenGeneratedOutput(output, originalPrompt) {
  const result = await parseFetch("/v1/screen-output", {
    output,
    context: {
      source: "agent_output",
      original_prompt: originalPrompt,
      integration: "examples/agent-loop-js.mjs",
    },
  });

  if (shouldBlockParseResult(result)) {
    return { allowed: false, reason: "Parse flagged the output", result };
  }

  return { allowed: true, result };
}

async function verifyPeerAgent(message, sourceAgent) {
  const result = await parseFetch("/v1/agent/trust/verify", {
    message,
    source_agent: sourceAgent,
    context: "peer agent requested delegation or private context",
  });

  const verdict = String(result.verdict || result.decision?.verdict || "").toLowerCase();
  const riskScore = result.risk_score ?? 0;
  return {
    allowed: !["block", "deny"].includes(verdict) && riskScore < 7,
    result,
  };
}

async function agentLoop(untrustedPrompt) {
  const inputCheck = await screenUntrustedInput(untrustedPrompt);
  if (!inputCheck.allowed) return "I can’t safely act on that request.";

  // Replace this with your real model/tool call. Keep privileged tools behind the input check.
  const draftOutput = `Safe summary of: ${untrustedPrompt}`;

  const outputCheck = await screenGeneratedOutput(draftOutput, untrustedPrompt);
  if (!outputCheck.allowed) return "I drafted a response, but it failed output safety screening.";

  return draftOutput;
}

const prompt = process.argv.slice(2).join(" ") || "Summarize this note: ship the beta packet to testers.";
agentLoop(prompt)
  .then((answer) => console.log(answer))
  .catch((err) => {
    console.error(JSON.stringify({ message: err.message, status: err.status, retryable: err.retryable, body: err.body }, null, 2));
    process.exit(err.retryable ? 75 : 1);
  });

export { agentLoop, screenUntrustedInput, screenGeneratedOutput, verifyPeerAgent };
