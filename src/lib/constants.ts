/** Canonical external URLs — single source of truth */
// The monitored support mailbox. Every sales and support mailto on the public
// pages renders from this, so it must not be a personal address.
export const CONTACT_EMAIL = "d@kurult.ai";

/**
 * Owner of every key minted through the public signup paths, which have no
 * account behind them. `api_keys.user_id` carries a foreign key to `users`, so
 * this row must exist or the insert fails and the key falls to the Redis
 * store — where checkout can never grant it a tier. See ensureSelfServiceUser.
 */
export const SELF_SERVICE_USER_ID = "self-service";

/**
 * Demo API key used by the public /demo page and Prompt Guard playground.
 * Falls back to process.env.DEMO_API_KEY so operators can set it in production.
 * If neither is set, the demo features show a graceful "demo key not configured" state.
 */
export const DEMO_API_KEY: string | null = process.env.DEMO_API_KEY || null;
