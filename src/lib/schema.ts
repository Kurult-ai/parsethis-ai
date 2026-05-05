import { PRODUCT } from "./product-facts.js";

/**
 * JSON-LD structured data generators for GEO-optimized pages.
 * Each function returns a plain object ready for JSON.stringify.
 */

export function organizationSchema(baseUrl: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: PRODUCT.name,
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
    description:
      PRODUCT.description,
    foundingDate: "2025",
  };
}

export function webApplicationSchema(baseUrl: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: PRODUCT.name,
    url: baseUrl,
    applicationCategory: "SecurityApplication",
    description:
      PRODUCT.description,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free tier available",
    },
    featureList: [
      "Prompt injection detection",
      "Prompt protection for AI agents",
      "Jailbreak attempt analysis",
      "LLM output screening",
      "Agent trust verification",
      "x402 pay-per-call access",
      "MCP tool discovery",
    ],
  };
}

export function webAPISchema(baseUrl: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: "Parse API",
    description:
      "REST API and hosted MCP endpoint for prompt protection, output screening, agent trust verification, and x402 pay-per-call access.",
    documentation: `${baseUrl}/docs`,
    provider: {
      "@type": "Organization",
      name: PRODUCT.name,
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
      name: PRODUCT.name,
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
