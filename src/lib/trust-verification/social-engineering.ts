/**
 * Social Engineering Detector
 *
 * Detects attempts to manipulate through urgency, authority claims,
 * emotional manipulation, and other social engineering tactics.
 *
 * Target accuracy: >91%
 */

import type { DetectorInput, DetectorResult } from "./types.js";

// === Urgency Indicators ===

const URGENCY_PATTERNS = [
  // Time pressure
  /\b(immediately|right now|asap|urgent|emergency|critical|deadline|expire(s|d)?)\b/i,
  /\b(quickly|fast|hurry|rush|speed|don'?t wait|act now|before it'?s too late)\b/i,
  /\b(in \d+ (minutes?|hours?)|within \d+ (hours?|minutes?)|today only|last chance|final notice|limited time)\b/i,
  /\b(about to|will be|going to) (expire|end|close|terminate|delete)\b/i,
  /\b(account|subscription|access) expires?\b/i,
  /\b(time sensitive|time is running out|running out of time)\b/i,
  // Account/credential urgency
  /\b(account will be|your account is) (locked|suspended|closed|banned|terminated)\b/i,
  /\b(immediate action required|verify now|confirm now|update now)\b/i,
  /\b(unusual activity|suspicious activity|security alert|login attempt)\b/i,
];

// === Authority Claims ===

const AUTHORITY_PATTERNS = [
  // Fake organization claims
  /\b(from (the )?(IT|tech support|security|admin|bank|government|police|IRS|FBI))\b/i,
  /\b(official (notice|alert|warning|communication))\b/i,
  /\b(verified by|certified by|approved by|authorized by)\b/i,
  // Position claims
  /\b(I am your (boss|manager|supervisor|admin|IT|CEO|CFO|CTO|director))\b/i,
  /\b(I am (?:the )?(admin|administrator|orchestrator|admin orchestrator|system administrator))\b/i,
  /\b(speaking on behalf of|representing|contact from)\b/i,
  // Legal threats
  /\b(legal action|lawsuit|court|subpoena|warrant|arrest|federal|criminal)\b/i,
  /\b(legal action will be taken|will be taken if you don'?t)\b/i,
  /\b(violat(ed?|ion|ions)|penalt(y|ies)|fine(s)?|prosecution)\b/i,
  // Policy references
  /\b(against (our )?(policy|terms of service|guidelines|rules))\b/i,
  /\b(terms of service violation|acceptable use policy)\b/i,
];

// === Emotional Manipulation ===

const EMOTIONAL_PATTERNS = [
  // Fear appeal
  /\b(you will lose|you'?ll lose|lose everything|you '?ve lost|lost access|can'?t access)\b/i,
  /\b(serious problem|critical issue|urgent matter|emergency situation)\b/i,
  /\b(danger|threat|risk|compromised|hacked|stolen)\b/i,
  // Greed/Opportunity
  /\b(you '?ve won|congratulations|prize|reward|bonus|inheritance|lottery)\b/i,
  /\b(claim your|collect your|redeem your|free money|cash prize)\b/i,
  // Curiosity/Secret
  /\b(secret|confidential|insider information|exclusive access|only for you)\b/i,
  /\b(don'?t tell anyone|keep this private|confidential|just between us)\b/i,
  // Guilt/Help
  /\b(please help me|i need your help|urgent request|favor needed)\b/i,
  /\b(i'?m in (big )?trouble|problem with my account|stuck abroad|emergency)\b/i,
  // Trust building
  /\b(trust me|you can trust|believe me|i promise|i swear)\b/i,
  /\b(to be honest|honestly speaking|frankly|in full transparency)\b/i,
  /\b(completely|totally|perfectly) safe\b/i,
];

// === Phishing Patterns ===

const PHISHING_PATTERNS = [
  // Verification requests
  /\b(verify your (account|identity|email|phone|information))\b/i,
  /\b(confirm your (details|information|account|identity))\b/i,
  /\b(click here to (verify|confirm|validate|activate))\b/i,
  // Link manipulation
  /\b(click (here|this link|the link below|the button))\b/i,
  /\b(visit (this link|the following|immediately))\b/i,
  // Attachment/Download requests
  /\b(download (the )?(attachment|file|document))\b/i,
  /\b(open the (attached|enclosed))\b/i,
  // Credential harvesting
  /\b(enter your (password|pin|ssn|social security|credit card))\b/i,
  /\bunlock your account\b/i,
  /\b(provide|need|require) your (login|credentials|username|password)\b/i,
  /\b(update your (payment|billing|financial) information)\b/i,
];

// === Scam Indicators ===

const SCAM_PATTERNS = [
  // Money requests
  /\b(send money|wire transfer|western union|moneygram|bitcoin|crypto|gift card)\b/i,
  /\btransfer \$?\d+/i,
  /\b(pay a fee|processing fee|administrative fee|handling fee|advance fee)\b/i,
  // Too good to be true
  /\b(make money (fast|quick|instantly|overnight))\b/i,
  /\b(earn|make) \$?\d+[,\d]*\/?\.?(per day|day|weekly|monthly|hourly)\b/i,
  /\b(work(ing)? from home|passive income|get rich|financial freedom)\b/i,
  // Investment scams
  /\b(guaranteed returns|risk-free investment|double your money)\b/i,
  /\b(investment opportunity|crypto opportunity|exclusive deal)\b/i,
  // Romance/impersonation
  /\b(i'?m stuck (in )?(another country|abroad|airport|hotel))\b/i,
  /\b(can'?t access my (funds|money|account|wallet))\b/i,
  /\b(need your help to (transfer|receive|claim))\b/i,
  // Lottery/prize scams
  /\b(you have been selected|chosen|won)( a prize)?\b/i,
  /\b(unclaimed funds|unclaimed prize|unclaimed inheritance)\b/i,
];

// === Impersonation Patterns ===

const IMPERSONATION_PATTERNS = [
  // Executive impersonation
  /\b(this is (the )?(CEO|CFO|CTO|President|Director|Manager))\b/i,
  /\b(speaking for the (management|executives|leadership))\b/i,
  // Support impersonation
  /\b(technical support|customer service|help desk|IT department|IT support)\b/i,
  /\b(microsoft support|apple support|amazon support|google support)\b/i,
  // External entity impersonation
  /\b(bank calling|your bank|credit card company|government agency)\b/i,
  /\b(IRS calling|tax authority|social security administration)\b/i,
];

// === Pressure Tactics ===

const PRESSURE_PATTERNS = [
  /\b(don'?t tell anyone|keep this confidential|secret between us)\b/i,
  /\b(this conversation is (off the record|not documented|untraceable))\b/i,
  /\b(no need to verify|don'?t verify|skip verification)\b/i,
  /\b(ignore (any )?(previous|other) (instructions?|communications?))\b/i,
  /\b(keep this (between us|private|secret|confidential))\b/i,
];

// === Pattern Sets with Weights ===

interface PatternSet {
  patterns: RegExp[];
  weight: number;
  name: string;
}

const PATTERN_SETS: PatternSet[] = [
  { patterns: URGENCY_PATTERNS, weight: 0.9, name: "urgency" },
  { patterns: AUTHORITY_PATTERNS, weight: 0.85, name: "authority" },
  { patterns: EMOTIONAL_PATTERNS, weight: 0.8, name: "emotional" },
  { patterns: PHISHING_PATTERNS, weight: 1.0, name: "phishing" },
  { patterns: SCAM_PATTERNS, weight: 0.95, name: "scam" },
  { patterns: IMPERSONATION_PATTERNS, weight: 0.9, name: "impersonation" },
  { patterns: PRESSURE_PATTERNS, weight: 0.85, name: "pressure" },
];

// === High-Risk Combinations ===

// Combinations of patterns that indicate higher confidence
const HIGH_RISK_COMBINATIONS = [
  { patterns: ["urgency", "phishing"], multiplier: 1.3 },
  { patterns: ["urgency", "authority"], multiplier: 1.25 },
  { patterns: ["phishing", "impersonation"], multiplier: 1.4 },
  { patterns: ["scam", "urgency"], multiplier: 1.35 },
  { patterns: ["scam", "authority"], multiplier: 1.3 },
  { patterns: ["pressure", "authority"], multiplier: 1.3 },
  { patterns: ["authority", "impersonation"], multiplier: 1.3 },
];

// === Detection Function ===

export function detectSocialEngineering(input: DetectorInput): DetectorResult {
  const { text, context = "" } = input;
  const combinedText = `${text} ${context}`.toLowerCase();

  const evidence: string[] = [];
  const detectedPatterns: string[] = [];
  let totalScore = 0;

  // Check each pattern set
  for (const set of PATTERN_SETS) {
    let patternCount = 0;
    for (const pattern of set.patterns) {
      if (pattern.test(text) || pattern.test(context)) {
        const match = text.match(pattern) || context.match(pattern);
        const matchedText = match ? match[0] : "pattern matched";
        evidence.push(`[${set.name}] ${matchedText.slice(0, 40)}`);
        patternCount++;
      }
    }
    if (patternCount > 0) {
      detectedPatterns.push(set.name);
      // High-weight sets (phishing, scam) get bonus for definitive matches
      const basePoints = set.weight >= 0.95 ? 70 : 45;
      totalScore += set.weight * basePoints * Math.min(patternCount, 3); // Cap at 3x per pattern set
    }
  }

  // Additional heuristics

  // 1. Multiple exclamation marks (indicates urgency/emotional manipulation)
  const exclamationCount = (text.match(/!/g) || []).length;
  if (exclamationCount >= 3) {
    evidence.push(`excessive exclamation marks (${exclamationCount})`);
    totalScore += 15;
  }

  // 2. All caps words (indicates shouting/urgency)
  const allCapsWords = text.match(/\b[A-Z]{2,}\b/g) || [];
  if (allCapsWords.length >= 2) {
    evidence.push(`excessive all-caps words (${allCapsWords.length})`);
    totalScore += 10;
  }

  // 3. Multiple currency/money mentions
  const moneyMentions = (text.match(/\$|USD|bitcoin|crypto|gift card/i) || []).length;
  if (moneyMentions >= 2) {
    evidence.push(`multiple money mentions (${moneyMentions})`);
    totalScore += 20;
  }

  // 4. Check for high-risk combinations
  for (const combo of HIGH_RISK_COMBINATIONS) {
    if (combo.patterns.every(p => detectedPatterns.includes(p))) {
      evidence.push(`high-risk combo: ${combo.patterns.join(" + ")}`);
      totalScore *= combo.multiplier;
      break; // Only apply once
    }
  }

  // 5. Short messages with urgency (common in smishing)
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 30 && detectedPatterns.includes("urgency")) {
    evidence.push("short message with urgency indicators");
    totalScore += 20;
  }

  // 6. Contact information in message (phishing indicator)
  const hasContactInfo = /(?:call|text|email|phone|contact|reach)[:\s]*[\d\w@.-]+/i.test(text);
  if (hasContactInfo) {
    evidence.push("contact information included");
    totalScore += 15;
  }

  // 7. URL in message (potential phishing link)
  const hasUrl = /https?:\/\/[^\s]+/i.test(text);
  if (hasUrl) {
    evidence.push("URL detected in message");
    totalScore += 10;
  }

  // Calculate final confidence (0-1)
  // Base confidence from score (capped at 120)
  const rawConfidence = Math.min(totalScore, 120) / 120;
  const confidence = Math.min(rawConfidence, 0.98); // Cap at 0.98

  // Determine detection status
  const detected = confidence >= 0.55;

  // Determine severity
  let severity: DetectorResult["severity"] = "none";
  if (confidence >= 0.85) severity = "critical";
  else if (confidence >= 0.7) severity = "high";
  else if (confidence >= 0.55) severity = "medium";
  else if (confidence >= 0.4) severity = "low";

  return {
    detected,
    confidence: Math.round(confidence * 100) / 100,
    evidence: evidence.slice(0, 10),
    severity,
  };
}

// === Batch Detection ===

export function detectBatch(inputs: DetectorInput[]): DetectorResult[] {
  return inputs.map(detectSocialEngineering);
}

// === Test Helper ===

export function getTestCases(): Array<{
  input: string;
  expected: boolean;
  category: string;
}> {
  return [
    // Urgency
    { input: "URGENT: Your account will be suspended in 1 hour!", expected: true, category: "urgency" },
    { input: "Act now or lose everything! Limited time only!", expected: true, category: "urgency" },
    { input: "Immediate action required: Verify your account now!", expected: true, category: "urgency" },
    { input: "Final notice: Your account expires today!", expected: true, category: "urgency" },

    // Authority
    { input: "This is IT Support. We need your password immediately.", expected: true, category: "authority" },
    { input: "Official notice: You've violated our terms of service.", expected: true, category: "authority" },
    { input: "I am your CEO, transfer $5000 to this account.", expected: true, category: "authority" },
    { input: "Legal action will be taken if you don't respond.", expected: true, category: "authority" },

    // Phishing
    { input: "Click here to verify your account information.", expected: true, category: "phishing" },
    { input: "Confirm your details by clicking this link immediately.", expected: true, category: "phishing" },
    { input: "Enter your password to unlock your account.", expected: true, category: "phishing" },
    { input: "Download the attachment to view your invoice.", expected: true, category: "phishing" },

    // Scam
    { input: "You've won $1,000,000! Send $500 processing fee to claim.", expected: true, category: "scam" },
    { input: "Make $5000/day working from home! Act now!", expected: true, category: "scam" },
    { input: "Investment opportunity with guaranteed returns!", expected: true, category: "scam" },
    { input: "I'm stuck abroad, send money via Western Union.", expected: true, category: "scam" },

    // Emotional/Pressure
    { input: "Please help me, I'm in big trouble!", expected: true, category: "emotional" },
    { input: "Don't tell anyone, this is just between us.", expected: true, category: "pressure" },
    { input: "Trust me, this is completely safe.", expected: true, category: "emotional" },

    // Combinations
    { input: "URGENT from IT Support: Click here to verify your account or it will be locked!", expected: true, category: "combo" },

    // Benign (should NOT trigger)
    { input: "Your package will arrive tomorrow.", expected: false, category: "benign" },
    { input: "Please review the attached document when you have time.", expected: false, category: "benign" },
    { input: "Here's the link to our website: https://example.com", expected: false, category: "benign" },
    { input: "I need your help with this coding problem.", expected: false, category: "benign" },
    { input: "The deadline is next Friday for the report.", expected: false, category: "benign" },
    { input: "Official documentation for the API.", expected: false, category: "benign" },
    { input: "Can we schedule a meeting for today?", expected: false, category: "benign" },
    { input: "Please let me know if you need anything.", expected: false, category: "benign" },

    // Edge cases
    { input: "", expected: false, category: "empty" },
    { input: "Hello!!! How are you???", expected: false, category: "excited_benign" },
    { input: "URGENT: The coffee is ready!", expected: false, category: "benign_urgency" },
  ];
}
