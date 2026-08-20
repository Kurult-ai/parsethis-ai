import type { ChatMessage, ChatResponse, TokenUsage } from "./types.js";
import { callLLMFull, streamLLM } from "./model-client.js";
import { getAnalysis } from "./analyzer.js";
import { v4 as uuidv4 } from "uuid";

const SYSTEM_PROMPT = `You are Parse, an AI media analysis assistant. You help users critically evaluate news articles, media content, and information sources.

Your capabilities:
- Analyze URLs for credibility, bias, and deception
- Fact-check claims and identify logical fallacies
- Assess evidence quality and source reliability
- Provide balanced perspectives (steel-manning)
- Explain media literacy concepts

When a user provides a URL, suggest they use the /v1/analyze endpoint for a full analysis.
When discussing analysis results, reference specific findings and scores.
Be direct, analytical, and evidence-based in your responses.`;

export async function handleChat(
  messages: ChatMessage[],
  context?: { url?: string; analysis_id?: string },
  model?: string
): Promise<ChatResponse> {
  // Build context-enhanced messages
  const enhancedMessages = buildContextMessages(messages, context);

  const result = await callLLMFull(enhancedMessages, model);

  return {
    id: uuidv4(),
    message: { role: "assistant", content: result.content },
    usage: result.tokenUsage,
    context_used: context ? Object.keys(context).filter((k) => (context as any)[k]) : [],
  };
}

export async function* handleChatStream(
  messages: ChatMessage[],
  context?: { url?: string; analysis_id?: string },
  model?: string
): AsyncGenerator<string> {
  const enhancedMessages = buildContextMessages(messages, context);

  for await (const chunk of streamLLM(enhancedMessages, model)) {
    yield chunk;
  }
}

function buildContextMessages(
  messages: ChatMessage[],
  context?: { url?: string; analysis_id?: string }
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Inject analysis context if available
  if (context?.analysis_id) {
    const analysis = getAnalysis(context.analysis_id);
    if (analysis?.analysis) {
      result.push({
        role: "system",
        content: `Analysis context for "${analysis.article?.title}" (${analysis.url}):
Credibility: ${analysis.analysis.credibility_score}/100 (${analysis.analysis.verdict})
Genre: ${analysis.analysis.genre}
Summary: ${analysis.analysis.summary}
Key claims: ${analysis.analysis.claims.map((c) => `${c.text} [${c.verdict}]`).join("; ")}
Bias: ${analysis.analysis.bias_assessment.direction} (confidence: ${analysis.analysis.bias_assessment.confidence})
Key takeaways: ${analysis.analysis.key_takeaways.join("; ")}`,
      });
    }
  }

  if (context?.url) {
    result.push({
      role: "system",
      content: `The user is asking about this URL: ${context.url}`,
    });
  }

  // Add user messages
  for (const msg of messages) {
    result.push({ role: msg.role, content: msg.content });
  }

  return result;
}
