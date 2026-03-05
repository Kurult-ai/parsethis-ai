import type {
  AnalysisResult,
  ExtractedArticle,
  MediaAnalysis,
  Claim,
  DeceptionIndicator,
  Fallacy,
  BiasAssessment,
  EvidenceQuality,
} from "./types.js";
import { v4 as uuidv4 } from "uuid";
import { callLLM } from "./llm.js";

// Extract JSON from LLM response that might contain markdown code blocks
function extractJSON(text: string): string {
  // Try to find JSON in markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Try to find JSON object or array directly
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) return jsonMatch[1].trim();

  return text.trim();
}

// In-memory analysis store
const analyses = new Map<string, AnalysisResult>();

export function getAnalysis(id: string): AnalysisResult | undefined {
  return analyses.get(id);
}

export function listAnalyses(): AnalysisResult[] {
  return Array.from(analyses.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50);
}

export async function startAnalysis(
  url: string,
  depth: "quick" | "standard" | "deep" = "standard",
  onProgress?: (event: string, data: any) => void
): Promise<AnalysisResult> {
  const id = uuidv4();
  const agents =
    depth === "quick"
      ? ["extraction", "credibility", "takeaways"]
      : depth === "deep"
        ? ["extraction", "deception", "fallacy", "steel_man", "evidence", "fact_check", "bias", "persuasion", "credibility", "takeaways"]
        : ["extraction", "deception", "fallacy", "evidence", "bias", "credibility", "takeaways"];

  const result: AnalysisResult = {
    id,
    status: "queued",
    created_at: new Date().toISOString(),
    url,
    depth,
    agents_completed: [],
    agents_total: agents,
    progress: 0,
  };

  analyses.set(id, result);

  // Run analysis asynchronously
  runAnalysis(id, url, depth, agents, onProgress).catch((err) => {
    const r = analyses.get(id);
    if (r) {
      r.status = "error";
      r.error = err.message;
    }
    onProgress?.("error", { error: err.message });
  });

  return result;
}

async function runAnalysis(
  id: string,
  url: string,
  depth: string,
  agents: string[],
  onProgress?: (event: string, data: any) => void
) {
  const result = analyses.get(id)!;
  const startTime = Date.now();

  // Phase 1: Extract article
  result.status = "extracting";
  onProgress?.("status", { status: "extracting", agent: "extraction" });

  const article = await extractArticle(url);
  result.article = article;
  result.agents_completed = ["extraction"];
  result.progress = Math.round((1 / agents.length) * 100);
  onProgress?.("extraction_complete", { article: { title: article.title, source: article.source, word_count: article.word_count } });

  // Phase 2: Run analysis agents
  result.status = "analyzing";
  const analysisAgents = agents.filter((a) => a !== "extraction");

  const agentResults: Record<string, any> = {};
  for (const agent of analysisAgents) {
    onProgress?.("agent_start", { agent });

    try {
      agentResults[agent] = await runAgent(agent, article, depth);
      result.agents_completed!.push(agent);
      result.progress = Math.round((result.agents_completed!.length / agents.length) * 100);
      onProgress?.("agent_complete", { agent, progress: result.progress });
    } catch (err: any) {
      onProgress?.("agent_error", { agent, error: err.message });
      agentResults[agent] = { error: err.message };
    }
  }

  // Phase 3: Synthesize results
  result.analysis = synthesizeAnalysis(agentResults, article);
  result.status = "completed";
  result.completed_at = new Date().toISOString();
  result.duration_ms = Date.now() - startTime;
  result.progress = 100;

  onProgress?.("completed", {
    credibility_score: result.analysis.credibility_score,
    verdict: result.analysis.verdict,
    duration_ms: result.duration_ms,
  });
}

async function extractArticle(url: string): Promise<ExtractedArticle> {
  const extractionPrompt = `You are an article extraction agent. Given a URL, describe what you know about the article or content at this URL.

URL: ${url}

IMPORTANT: Respond with ONLY a JSON object, no markdown, no code blocks, no explanation. Just raw JSON:
{"title": "article title or best guess", "author": "author name if known, or null", "published_date": "date if known, or null", "source": "domain/publication name", "content": "the main text content or your best summary of what this URL contains", "word_count": 0, "excerpt": "first 200 characters of content"}

If you don't know the specific article, provide your best analysis based on the URL structure, domain reputation, and any knowledge you have.`;

  const response = await callLLM(extractionPrompt);

  try {
    const parsed = JSON.parse(extractJSON(response));
    return {
      title: parsed.title || "Unknown Title",
      author: parsed.author || undefined,
      published_date: parsed.published_date || undefined,
      source: parsed.source || new URL(url).hostname,
      content: parsed.content || "",
      word_count: parsed.word_count || 0,
      excerpt: parsed.excerpt || "",
    };
  } catch {
    // If LLM didn't return valid JSON, construct from what we have
    const domain = new URL(url).hostname;
    return {
      title: "Article from " + domain,
      source: domain,
      content: response,
      word_count: response.split(/\s+/).length,
      excerpt: response.slice(0, 200),
    };
  }
}

async function runAgent(agent: string, article: ExtractedArticle, depth: string): Promise<any> {
  const articleContext = `Title: ${article.title}\nSource: ${article.source}\nAuthor: ${article.author || "Unknown"}\n\nContent:\n${article.content.slice(0, 4000)}`;

  switch (agent) {
    case "deception":
      return runDeceptionAgent(articleContext);
    case "fallacy":
      return runFallacyAgent(articleContext);
    case "steel_man":
      return runSteelManAgent(articleContext);
    case "evidence":
      return runEvidenceAgent(articleContext);
    case "fact_check":
      return runFactCheckAgent(articleContext);
    case "bias":
      return runBiasAgent(articleContext);
    case "persuasion":
      return runPersuasionAgent(articleContext);
    case "credibility":
      return runCredibilityAgent(articleContext);
    case "takeaways":
      return runTakeawaysAgent(articleContext);
    default:
      return { error: `Unknown agent: ${agent}` };
  }
}

async function runDeceptionAgent(content: string): Promise<DeceptionIndicator[]> {
  const prompt = `You are a deception detection specialist. Analyze this article for manipulation tactics, propaganda techniques, and deceptive framing.

${content}

Return a JSON array of deception indicators:
[{"type": "technique_name", "severity": "low|medium|high", "description": "explanation", "quote": "relevant quote if applicable"}]

Return [] if no deception detected. IMPORTANT: Return ONLY raw JSON, no markdown, no code blocks.`;

  const response = await callLLM(prompt);
  try {
    return JSON.parse(extractJSON(response));
  } catch {
    return [];
  }
}

async function runFallacyAgent(content: string): Promise<Fallacy[]> {
  const prompt = `You are a logical fallacy detection expert. Analyze this article for logical fallacies.

${content}

Return a JSON array of fallacies found:
[{"name": "fallacy name", "description": "how it's used here", "quote": "relevant quote"}]

Return [] if no fallacies detected. IMPORTANT: Return ONLY raw JSON, no markdown, no code blocks.`;

  const response = await callLLM(prompt);
  try {
    return JSON.parse(extractJSON(response));
  } catch {
    return [];
  }
}

async function runSteelManAgent(content: string): Promise<string> {
  const prompt = `You are a steel-manning expert. Present the strongest possible version of this article's argument, even if you disagree with it. Be concise (2-3 paragraphs).

${content}

Return only the steel-manned argument as plain text.`;

  return await callLLM(prompt);
}

async function runEvidenceAgent(content: string): Promise<EvidenceQuality> {
  const prompt = `You are an evidence quality assessor. Evaluate the quality of evidence and sourcing in this article.

${content}

Return JSON:
{"score": 0-100, "source_count": number, "primary_sources": number, "expert_citations": number, "details": ["detail1", "detail2"]}

IMPORTANT: Return ONLY raw JSON, no markdown, no code blocks.`;

  const response = await callLLM(prompt);
  try {
    return JSON.parse(extractJSON(response));
  } catch {
    return { score: 50, source_count: 0, primary_sources: 0, expert_citations: 0, details: ["Unable to assess evidence quality"] };
  }
}

async function runFactCheckAgent(content: string): Promise<Claim[]> {
  const prompt = `You are a fact-checker. Identify the main claims in this article and assess their accuracy.

${content}

Return a JSON array of claims:
[{"text": "the claim", "verdict": "supported|partially_supported|unsupported|misleading", "confidence": 0.0-1.0, "evidence": "your reasoning"}]

Return up to 5 most important claims. IMPORTANT: Return ONLY raw JSON, no markdown, no code blocks.`;

  const response = await callLLM(prompt);
  try {
    return JSON.parse(extractJSON(response));
  } catch {
    return [];
  }
}

async function runBiasAgent(content: string): Promise<BiasAssessment> {
  const prompt = `You are a media bias analyst. Assess the political and ideological bias in this article.

${content}

Return JSON:
{"direction": "left|center-left|center|center-right|right|unclear", "confidence": 0.0-1.0, "indicators": ["indicator1", "indicator2"]}

IMPORTANT: Return ONLY raw JSON, no markdown, no code blocks.`;

  const response = await callLLM(prompt);
  try {
    return JSON.parse(extractJSON(response));
  } catch {
    return { direction: "unclear", confidence: 0, indicators: [] };
  }
}

async function runPersuasionAgent(content: string): Promise<any> {
  const prompt = `You are a persuasion technique analyst. Identify rhetorical and persuasion techniques used in this article.

${content}

Return JSON:
{"techniques": [{"name": "technique", "description": "how it's used", "effectiveness": "low|medium|high"}], "emotional_appeal_score": 0-100, "rational_appeal_score": 0-100}

IMPORTANT: Return ONLY raw JSON, no markdown, no code blocks.`;

  const response = await callLLM(prompt);
  try {
    return JSON.parse(extractJSON(response));
  } catch {
    return { techniques: [], emotional_appeal_score: 50, rational_appeal_score: 50 };
  }
}

async function runCredibilityAgent(content: string): Promise<any> {
  const prompt = `You are a credibility assessment expert. Provide an overall credibility assessment of this article.

${content}

Return JSON:
{"score": 0-100, "verdict": "reliable|mostly_reliable|mixed|questionable|unreliable", "genre": "news|opinion|analysis|satire|press_release|other", "summary": "2-3 sentence assessment", "recommendations": ["recommendation1", "recommendation2"]}

IMPORTANT: Return ONLY raw JSON, no markdown, no code blocks.`;

  const response = await callLLM(prompt);
  try {
    return JSON.parse(extractJSON(response));
  } catch {
    return { score: 50, verdict: "mixed", genre: "other", summary: "Unable to fully assess credibility.", recommendations: [] };
  }
}

async function runTakeawaysAgent(content: string): Promise<string[]> {
  const prompt = `You are a key takeaways specialist. Provide 3-5 key takeaways from this article that a reader should know.

${content}

Return a JSON array of strings:
["takeaway 1", "takeaway 2", "takeaway 3"]

IMPORTANT: Return ONLY raw JSON, no markdown, no code blocks.`;

  const response = await callLLM(prompt);
  try {
    return JSON.parse(extractJSON(response));
  } catch {
    return ["Unable to extract key takeaways"];
  }
}

function synthesizeAnalysis(agentResults: Record<string, any>, article: ExtractedArticle): MediaAnalysis {
  const credibility = agentResults.credibility || {};
  const bias = agentResults.bias || { direction: "unclear", confidence: 0, indicators: [] };
  const evidence = agentResults.evidence || { score: 50, source_count: 0, primary_sources: 0, expert_citations: 0, details: [] };

  return {
    credibility_score: credibility.score ?? 50,
    verdict: credibility.verdict ?? "mixed",
    genre: credibility.genre ?? "other",
    summary: credibility.summary ?? `Analysis of "${article.title}" from ${article.source}.`,
    claims: agentResults.fact_check || [],
    deception_indicators: agentResults.deception || [],
    fallacies: agentResults.fallacy || [],
    bias_assessment: bias,
    evidence_quality: evidence,
    key_takeaways: agentResults.takeaways || [],
    steel_man: agentResults.steel_man || "",
    recommendations: credibility.recommendations || [],
  };
}
