import { renderPage } from "../lib/html-template.js";
import { loadContentBySlug } from "../lib/markdown.js";
import {
  articleSchema,
  organizationSchema,
  breadcrumbSchema,
} from "../lib/schema.js";

/**
 * Render a content page from markdown, or return raw markdown if wantsMarkdown is true.
 * Supports content negotiation: Accept: text/markdown returns raw .md content.
 */
function renderContentPage(
  directory: string,
  slug: string,
  baseUrl: string,
  sectionName: string,
  sectionPath: string,
  wantsMarkdown?: boolean
): { html: string; contentType: "text/html" } | { markdown: string; contentType: "text/markdown" } | null {
  const file = loadContentBySlug(directory, slug);
  if (!file) return null;

  // Fix #4: Return raw markdown when Accept: text/markdown
  if (wantsMarkdown) {
    return { markdown: file.markdown, contentType: "text/markdown" };
  }

  const fm = file.frontmatter;
  const title = (fm.title as string) || slug;
  const description = (fm.description as string) || "";
  const datePublished = (fm.date as string) || "2026-03-22";
  const dateModified = (fm.lastUpdated as string) || datePublished;
  const author = (fm.author as string) || "ParseThis.ai";
  const path = `/${sectionPath}/${slug}`;

  // Fix #12: Add <link rel="alternate"> for markdown version
  const mdAlternate = `<link rel="alternate" type="text/markdown" href="${baseUrl}${path}">`;

  return {
    html: renderPage({
      title,
      description,
      path,
      content: file.html,
      baseUrl,
      author,
      lastUpdated: dateModified,
      headExtra: mdAlternate,
      jsonLd: [
        articleSchema({
          baseUrl,
          title,
          description,
          path,
          datePublished,
          dateModified,
          author,
        }),
        organizationSchema(baseUrl),
        breadcrumbSchema([
          { name: "Home", url: `${baseUrl}/` },
          { name: sectionName, url: `${baseUrl}/${sectionPath}` },
          { name: title, url: `${baseUrl}${path}` },
        ]),
      ],
      breadcrumbs: [
        { name: "Home", href: "/" },
        { name: sectionName, href: `/${sectionPath}` },
        { name: title, href: path },
      ],
    }),
    contentType: "text/html",
  };
}

export function getContentMarkdown(directory: string, slug: string): string | null {
  const file = loadContentBySlug(directory, slug);
  return file ? file.markdown : null;
}

export function renderDocsPage(
  slug: string,
  baseUrl: string,
  wantsMarkdown?: boolean
): { html: string; contentType: "text/html" } | { markdown: string; contentType: "text/markdown" } | null {
  return renderContentPage("docs", slug, baseUrl, "Docs", "docs", wantsMarkdown);
}

export function renderGuidePage(
  slug: string,
  baseUrl: string,
  wantsMarkdown?: boolean
): { html: string; contentType: "text/html" } | { markdown: string; contentType: "text/markdown" } | null {
  return renderContentPage("guides", slug, baseUrl, "Guides", "guides", wantsMarkdown);
}

export function renderComparePage(
  slug: string,
  baseUrl: string,
  wantsMarkdown?: boolean
): { html: string; contentType: "text/html" } | { markdown: string; contentType: "text/markdown" } | null {
  return renderContentPage("compare", slug, baseUrl, "Compare", "compare", wantsMarkdown);
}
