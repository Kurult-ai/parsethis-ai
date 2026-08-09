/** Canonical external URLs — single source of truth */
export const CONTACT_EMAIL = "d@kurult.ai";

/**
 * Demo API key used by the public /demo page and Prompt Guard playground.
 * Falls back to process.env.DEMO_API_KEY so operators can set it in production.
 * If neither is set, the demo features show a graceful "demo key not configured" state.
 */
export const DEMO_API_KEY: string | null = process.env.DEMO_API_KEY || null;
