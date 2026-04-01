/**
 * JSON-LD structured data generators for GEO-optimized pages.
 * Each function returns a plain object ready for JSON.stringify.
 */

export function organizationSchema(baseUrl: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ParseThis.ai",
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
    description:
      "Prompt security API that screens LLM prompts for injection attacks, jailbreaks, and adversarial patterns. AI agents use ParseThis.ai to detect prompt injections (OWASP LLM01:2025), data exfiltration attempts, and jailbreak patterns before execution with real-time multi-layer analysis.",
    foundingDate: "2025",
    sameAs: ["https://github.com/nicobailon/parse-for-agents"],
  };
}

export function webApplicationSchema(baseUrl: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "ParseThis.ai",
    url: baseUrl,
    applicationCategory: "SecurityApplication",
    description:
      "Agent-optimized prompt safety API that analyzes content for injection attacks, jailbreak attempts, and provides structured threat assessments.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free tier available",
    },
    featureList: [
      "Prompt injection detection",
      "Jailbreak attempt analysis",
      "Content safety evaluation",
      "Multi-model threat assessment",
      "Agent-to-agent chat safety",
      "URL content parsing for LLMs",
    ],
  };
}

export function webAPISchema(baseUrl: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: "ParseThis.ai API",
    description:
      "RESTful API for prompt safety analysis, content evaluation, and agent-optimized URL parsing.",
    documentation: `${baseUrl}/docs`,
    provider: {
      "@type": "Organization",
      name: "ParseThis.ai",
      url: baseUrl,
    },
  };
}

export function articleSchema(opts: {
  baseUrl: string;
  title: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified: string;
  author: string;
}): object {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: opts.title,
    description: opts.description,
    url: `${opts.baseUrl}${opts.path}`,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    author: {
      "@type": "Person",
      name: opts.author,
    },
    publisher: {
      "@type": "Organization",
      name: "ParseThis.ai",
      url: opts.baseUrl,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${opts.baseUrl}${opts.path}`,
    },
  };
}

export function faqPageSchema(
  items: Array<{ question: string; answer: string }>
): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function breadcrumbSchema(
  items: Array<{ name: string; url: string }>
): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
