import type { TokenUsage } from "./types.js";
import { callLLMFull } from "./llm.js";

interface ExecutionResult {
  output: string;
  tokenUsage: TokenUsage;
  costEstimate: number;
}

export async function executePrompt(
  prompt: string,
  input: string,
  model: string
): Promise<ExecutionResult> {
  const messages = input
    ? [
        { role: "system", content: prompt },
        { role: "user", content: input },
      ]
    : [{ role: "user", content: prompt }];

  const result = await callLLMFull(messages, model);

  return {
    output: result.content,
    tokenUsage: result.tokenUsage,
    costEstimate: result.costEstimate,
  };
}
