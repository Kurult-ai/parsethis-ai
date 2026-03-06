import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Context, Next } from "hono";
import { recordPayment } from "./payment-ledger.js";

const X402_ENABLED = process.env.X402_ENABLED === "true";
const WALLET = process.env.X402_PAY_TO_ADDRESS || "";
const NETWORK = (process.env.X402_NETWORK || "eip155:8453") as `${string}:${string}`;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://facilitator.x402.org";

// Pricing table (USDC on Base L2)
export const PRICING = {
  parse: "$0.005",
  analyze: { quick: "$0.01", standard: "$0.05", deep: "$0.15" },
  evaluate: "$0.01",
  chat: "$0.005",
} as const;

// Initialize x402 middleware only when enabled and wallet configured
let x402MW: ((c: Context, next: Next) => Promise<Response | void>) | null = null;

if (X402_ENABLED && WALLET) {
  const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(NETWORK, new ExactEvmScheme());

  // Log settled payments to the in-memory ledger
  resourceServer.onAfterSettle(async (context) => {
    if (context.result.success) {
      // Convert base units back to decimal (USDC has 6 decimals)
      const amountDecimal = (parseInt(context.requirements.amount, 10) / 1_000_000).toString();
      const endpoint = context.paymentPayload.resource?.url || "unknown";
      // Extract just the path portion from the full URL
      let path = endpoint;
      try {
        path = new URL(endpoint).pathname;
      } catch {
        // already a path or unparseable — use as-is
      }

      recordPayment({
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
        accepts: {
          scheme: "exact",
          price: PRICING.parse,
          network: NETWORK,
          payTo: WALLET,
        },
        description: "Agent prompt safety analysis (0-10 risk score)",
      },
      "POST /v1/analyze": {
        accepts: {
          scheme: "exact",
          price: PRICING.analyze.standard,
          network: NETWORK,
          payTo: WALLET,
        },
        description: "Media credibility analysis",
      },
      "POST /v1/evaluate": {
        accepts: {
          scheme: "exact",
          price: PRICING.evaluate,
          network: NETWORK,
          payTo: WALLET,
        },
        description: "Prompt safety and quality evaluation",
      },
      "POST /v1/chat": {
        accepts: {
          scheme: "exact",
          price: PRICING.chat,
          network: NETWORK,
          payTo: WALLET,
        },
        description: "Chat with Parse AI assistant",
      },
    },
    resourceServer,
  );

  console.log(`[x402] Payment middleware enabled — wallet: ${WALLET.slice(0, 6)}...${WALLET.slice(-4)}, network: ${NETWORK}`);
} else if (X402_ENABLED && !WALLET) {
  console.warn("[x402] X402_ENABLED=true but X402_PAY_TO_ADDRESS not set — payments disabled");
}

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
  return X402_ENABLED && !!WALLET;
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
