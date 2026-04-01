import { Context, Next } from "hono";

/**
 * Content negotiation middleware.
 * If Accept: text/markdown is present, or URL ends with .md,
 * set a flag on the context so route handlers can serve markdown.
 */
export function contentNegotiation() {
  return async (c: Context, next: Next) => {
    const accept = c.req.header("Accept") || "";
    const path = c.req.path;

    // Check if client prefers markdown
    const wantsMarkdown = accept.includes("text/markdown") || path.endsWith(".md");

    // Store preference on context for route handlers
    c.set("wantsMarkdown" as any, wantsMarkdown);

    await next();

    // Add Vary header for caching correctness
    if (c.res.headers.get("Content-Type")?.includes("text/html")) {
      c.res.headers.set("Vary", "Accept");
    }
  };
}
