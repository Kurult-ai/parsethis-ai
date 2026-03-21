import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Context, Next } from "hono";
import { recordPayment } from "./payment-ledger.js";

const X402_ENABLED = process.env.X402_ENABLED === "true";
const WALLET = process.env.X402_PAY_TO_ADDRESS || "";
const NETWORK = (process.env.X402_NETWORK || "eip155:84532") as `${string}:${string}`;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

// Pricing table (USDC on Base Sepolia testnet)
export const PRICING = {
  parse: "$0.005",
  analyze: { quick: "$0.01", standard: "$0.05", deep: "$0.15" },
  evaluate: "$0.01",
  chat: "$0.005",
} as const;

// Initialize x402 middleware only when enabled and wallet configured
let x402MW: ((c: Context, next: Next) => Promise<Response | void>) | null = null;
let x402Ready = false;

/**
 * Initialize x402 payment middleware.
 * Uses try/catch + timeout race instead of deprecated node:domain.
 */
async function initX402(): Promise<void> {
  if (!X402_ENABLED || !WALLET) {
    if (X402_ENABLED && !WALLET) {
      console.warn("[x402] X402_ENABLED=true but X402_PAY_TO_ADDRESS not set — payments disabled");
    }
    return;
  }

  const INIT_TIMEOUT_MS = 10_000;

  const initPromise = (async () => {
    const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
    const resourceServer = new x402ResourceServer(facilitatorClient);

    // Register the network/scheme - this triggers async initialization
    resourceServer.register(NETWORK, new ExactEvmScheme());

    // Persist settled payments to Postgres
    resourceServer.onAfterSettle(async (context) => {
      if (context.result.success) {
        const amountDecimal = (parseInt(context.requirements.amount, 10) / 1_000_000).toString();
        const endpoint = context.paymentPayload.resource?.url || "unknown";
        let path = endpoint;
        try {
          path = new URL(endpoint).pathname;
        } catch {
          // already a path or unparseable — use as-is
        }

        await recordPayment({
          txHash: context.result.transaction,
          payer: context.result.payer || "unknown",
          amount: amountDecimal,
          endpoint: path,
          timestamp: new Date().toISOString(),
          network: context.result.network,
          status: "settled",
        });

        console.log(
          `[x402] Payment settled: ${amountDecimal} USDC from ${(context.result.payer || "unknown").slice(0, 10)}... tx:${context.result.transaction.slice(0, 10)}...`,
        );
      }
    });

    x402MW = paymentMiddleware(
      {
        "POST /v1/parse": {
          accepts: { scheme: "exact", price: PRICING.parse, network: NETWORK, payTo: WALLET },
          description: "Agent prompt safety analysis (0-10 risk score)",
        },
        "POST /v1/analyze": {
          accepts: { scheme: "exact", price: PRICING.analyze.standard, network: NETWORK, payTo: WALLET },
          description: "Media credibility analysis",
        },
        "POST /v1/evaluate": {
          accepts: { scheme: "exact", price: PRICING.evaluate, network: NETWORK, payTo: WALLET },
          description: "Prompt safety and quality evaluation",
        },
        "POST /v1/chat": {
          accepts: { scheme: "exact", price: PRICING.chat, network: NETWORK, payTo: WALLET },
          description: "Chat with Parse AI assistant",
        },
      },
      resourceServer,
    );

    x402Ready = true;
    console.log(`[x402] Payment middleware enabled — wallet: ${WALLET.slice(0, 6)}...${WALLET.slice(-4)}, network: ${NETWORK}`);
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("x402 init timed out")), INIT_TIMEOUT_MS)
  );

  try {
    await Promise.race([initPromise, timeoutPromise]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[x402] Failed to initialize payment middleware: ${message}`);
    console.error("[x402] Server will continue without x402 payments — fix facilitator connectivity and redeploy");
    x402MW = null;
    x402Ready = false;
  }
}

// Initialize async — does not block server startup
initX402().catch((err) => {
  console.error(`[x402] Unhandled init error: ${err.message}`);
});

/**
 * Middleware that intercepts x402 payment headers on POST routes.
 * If payment header present → verifies via x402 SDK → sets x402Paid flag → proceeds.
 * If no payment header → passes through to normal API key auth.
 */
export function x402Guard() {
  return async (c: Context, next: Next) => {
    // Only handle POST requests with payment headers when x402 is active
    if (c.req.method !== "POST" || !x402MW) {
      await next();
      return;
    }

    // Check for x402 payment header (protocol uses "x-payment")
    const hasPayment = c.req.header("x-payment");
    if (hasPayment) {
      // Route through x402 middleware for verification + settlement
      return x402MW(c, async () => {
        // Payment verified — mark context so auth middleware skips API key check
        c.set("x402Paid", true);
        await next();
      });
    }

    // No payment header — fall through to API key auth
    await next();
  };
}

export function isX402Enabled(): boolean {
  return X402_ENABLED && !!WALLET && x402Ready;
}

export function getPricingInfo() {
  return {
    enabled: isX402Enabled(),
    currency: "USDC",
    network: NETWORK,
    payTo: WALLET || "not_configured",
    facilitator: FACILITATOR_URL,
    endpoints: {
      "POST /v1/parse": PRICING.parse,
      "POST /v1/analyze": PRICING.analyze,
      "POST /v1/evaluate": PRICING.evaluate,
      "POST /v1/chat": PRICING.chat,
    },
    free_endpoints: ["GET /v1/models", "GET /v1/pricing", "POST /v1/keys/generate"],
    free_tier: {
      description: "Generate an API key for limited free access",
      url: "/v1/keys/generate",
    },
    agent_integration: {
      typescript: 'npm install @x402/fetch — then use wrapFetch(fetch, walletClient)',
      python: 'pip install x402 — then use wrap_requests(session, wallet)',
      cli: 'npm install -g @x402/purl — then use purl POST <url>',
    },
  };
}
