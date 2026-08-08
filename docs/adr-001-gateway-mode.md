# ADR-001: Gateway Mode — Build, Partner, or Defer

**Status:** Accepted
**Date:** 2026-08-08
**Decision Driver:** Kublai
**Supersedes:** —
**Resolves:** Task 12.1 (Gateway Build-vs-Partner Decision Spike)

---

## Context

Parse currently exposes a developer-facing REST API (`POST /v1/parse`, `POST /v1/screen-output`) for prompt and output screening. Two integration paths are planned:

1. **SDK wrappers** — thin client libraries that intercept calls before they reach OpenAI/Anthropic clients.
2. **Framework adapters** — Hermes and OpenClaw integrate by swapping model base URLs to a proxy endpoint.

The gateway question is: **should Parse itself operate an OpenAI/Anthropic-compatible reverse proxy** that screens every request/response in transit?

This matters because:

- **Hermes and OpenClaw integrate by base URL swap.** A user sets `OPENAI_BASE_URL=https://parse.dev/v1/proxy` and every model call is automatically screened — zero SDK code, zero agent changes. This is the lowest-friction integration path for the frameworks we care about most.
- **A gateway sees all traffic.** Unlike SDK wrappers that intercept only model calls the application explicitly routes through them, a proxy sees model calls *and* tool outputs *and* any intermediate reasoning the client streams — full coverage.
- **A gateway is C17 infrastructure.** It becomes a critical chokepoint in the customer's AI stack. Compromise or outage exposes all customer prompts, completions, and API keys. This is a security and reliability obligation, not a feature.
- **Latency compounds.** Every model call already has network + inference latency. Adding a screening hop on the hot path means screening must complete in single-digit milliseconds at p95 or it degrades the agent's responsiveness.

The current plan has Task 12.1 as a decision spike and Task 12.2 (build the gateway) gated on the outcome. This ADR makes the call and re-scopes 12.2.

## Options Evaluated

### Option A — Build (Parse operates the proxy)

Parse builds and operates an OpenAI/Anthropic-compatible reverse proxy. Customers point their `base_url` at Parse. The proxy screens requests (prompt injection, exfiltration, policy violations) before forwarding to the model provider, and screens responses on the way back.

- **Latency overhead:** Moderate-to-high. Every request adds a screening round-trip on the hot path. Regex layer is ~1-3 ms but LLM analysis layer adds 200-800 ms unless run async/fire-and-forget. The proxy must make a hard tradeoff: screen synchronously (latency) or screen asynchronously (screening may arrive after the model already responded).
- **Ops burden:** High. Parse becomes responsible for TLS termination, connection pooling to multiple model providers, streaming proxy correctness (SSE), retry/backoff semantics, and 99.9%+ uptime for a path that is now in every customer's critical loop.
- **C17 blast radius:** Maximum. Parse holds API keys for OpenAI/Anthropic/Google for every customer. A compromise exposes all customer traffic and credentials. This requires SOC 2 Type II, key encryption at rest, audit logging, and breach response — none of which are Parse's current operational strength.
- **Differentiation impact:** Ambiguous. The gateway distributes Parse into every customer's stack (good for adoption) but commoditizes it into "just a proxy" (bad if the proxy is the only integration path). The screening intelligence becomes invisible.
- **Time-to-integration for Hermes/OpenClaw:** Fastest — base URL swap, no code changes. But requires the proxy to be production-hardened first, which is a multi-month effort.

### Option B — Partner/Embed (Integrate with LiteLLM, Portkey, or similar)

Parse ships as a screening plugin/callback for an existing LLM gateway rather than operating the proxy itself. LiteLLM and Portkey already handle the proxy, routing, key management, and observability layers. Parse provides a callback handler or middleware that runs the screening pipeline on each request.

- **Latency overhead:** Same as Build for the screening itself, but the proxy plumbing is the partner's problem. Parse controls only the screening latency, which can be tuned independently.
- **Ops burden:** Low. Parse doesn't operate the proxy, manage keys, or guarantee uptime of the model path. The partner handles TLS, streaming, retry, provider compatibility.
- **C17 blast radius:** Minimal for Parse. The customer (or the gateway partner) holds the model API keys. Parse only sees prompts/completions transiently during screening — same as the REST API today. No new key custody.
- **Differentiation impact:** Positive. Parse stays a screening intelligence layer, not plumbing. The gateway partners handle distribution; Parse handles detection quality. Clean separation of concerns.
- **Time-to-integration for Hermes/OpenClaw:** Medium. Hermes already uses configurable base URLs. OpenClaw can integrate Parse as a LiteLLM callback. Not as trivial as a native base URL swap, but the adapter work is days, not months.

### Option C — Defer (SDK + REST API only, revisit gateway later)

Do not build or partner on a gateway now. Ship SDK wrappers and framework adapters that call the existing REST API. Revisit gateway mode after reaching product-market fit and operational maturity.

- **Latency overhead:** Lowest. Screening is opt-in per call, not on the hot path of every model request. Agents screen only when they have untrusted input.
- **Ops burden:** Lowest. Parse operates the API it already has. No new infrastructure class.
- **C17 blast radius:** None added. Parse never holds model API keys. Current security posture is unchanged.
- **Differentiation impact:** Neutral in the short term. Parse is a screening API, not infrastructure. Risk of losing framework integrations that *require* a base URL swap to adopt.
- **Time-to-integration for Hermes/OpenClaw:** Medium. Requires SDK/adapter code in Hermes and OpenClaw, but no new infrastructure on Parse's side.

## Decision Criteria (Weighted)

| Criterion | Weight | A: Build | B: Partner | C: Defer |
|-----------|--------|----------|------------|----------|
| p95 latency overhead | High | Poor (sync screen on hot path) | Fair (same screen, better plumbing) | Best (screen off hot path) |
| Ops burden | High | Worst (full proxy ops) | Low (partner handles plumbing) | Lowest (current infra only) |
| C17 blast radius | Critical | Worst (custody of all keys) | Minimal (no key custody) | None (status quo) |
| Differentiation impact | Medium | Ambiguous (commoditization risk) | Positive (intelligence layer) | Neutral |
| Time-to-integration (Hermes/OpenClaw) | Medium | Fastest (base URL swap) | Medium (adapter) | Medium (SDK/adapter) |

## Recommendation

**Partner/Embed (Option B), with Defer (Option C) as the fallback.**

Do not build a proprietary proxy gateway.

### Rationale

1. **C17 custody is the deciding factor.** Operating a proxy means Parse holds every customer's OpenAI/Anthropic API keys and sees all model traffic in plaintext. This is a security obligation that dwarfs the screening business. A single key-leak incident or traffic breach ends the company. The risk/reward is upside-down for a screening-focused product.

2. **The latency math doesn't favor a synchronous proxy.** Parse's LLM analysis layer adds 200-800 ms. On a model call that already takes 500-2000 ms, that's a 15-50% latency increase at p95. The screening pipeline is designed to be called *selectively* on untrusted input, not on every model call. Forcing it onto every request's hot path degrades the agent UX for the 90%+ of calls that are benign.

3. **Partners already solve the plumbing.** LiteLLM and Portkey handle proxying, streaming, multi-provider routing, key management, and observability. Parse adding value as a callback/middleware is strictly better than rebuilding all of that. Parse's moat is detection quality, not infrastructure.

4. **Hermes/OpenClaw integration is still fast.** Both frameworks support custom base URLs and callbacks. Shipping a Parse callback for LiteLLM (the most common gateway in the agent ecosystem) gets Hermes and OpenClaw integrated in days, not months. The adapter is a thin wrapper around the existing REST API.

5. **Defer is the honest fallback.** If partner integration proves harder than expected, the REST API + SDK path is already sufficient. The screening API works today. Gateway mode is an integration convenience, not a product requirement.

### What this means concretely

- **No proprietary proxy endpoint.** Parse will not expose `/v1/proxy` or `OPENAI_BASE_URL`-compatible endpoints.
- **Ship a LiteLLM callback handler** as the primary gateway integration. This is a small package (`@parse-ai/litellm-callback`) that wraps the existing screening API.
- **Ship SDK wrappers** (OpenAI/Anthropic client subclasses) as the secondary integration path for teams not using a gateway.
- **Revisit build mode only if** (a) a major customer requires native base URL swap and won't use a gateway, and (b) Parse has achieved SOC 2 Type II and dedicated infra ops capacity. Set a 6-month review checkpoint.

## Re-scoped Task 12.2

**Original Task 12.2:** Build the screening proxy gateway (OpenAI/Anthropic-compatible reverse proxy, streaming support, key management, production hardening). Estimated 4-6 weeks.

**Re-scoped Task 12.2:** Build a LiteLLM callback handler package and SDK wrappers.

| Item | Scope | Effort |
|------|-------|--------|
| `@parse-ai/litellm-callback` | Callback handler that calls Parse screening API on `async_pre_call_hook` and `async_post_call_hook`. Blocks or annotates based on policy. | 3-5 days |
| OpenAI client wrapper (`@parse-ai/openai-wrapper`) | Subclass `OpenAI` client, intercept `chat.completions.create`, screen prompt before call, screen response after. | 2-3 days |
| Anthropic client wrapper (`@parse-ai/anthropic-wrapper`) | Same pattern for Anthropic SDK. | 2-3 days |
| Hermes adapter | Document the base URL / callback configuration for Hermes deployments. | 1 day |
| OpenClaw adapter | Same for OpenClaw. | 1 day |
| Integration tests | End-to-end: Hermes agent with Parse callback, verify screening triggers and blocks propagate. | 2-3 days |

**Revised estimate:** 2-3 weeks (down from 4-6 weeks for the full proxy build). Eliminates C17 infra scope, key management, streaming proxy, and uptime guarantees.

**De-scoped entirely:** Proxy server, TLS termination, key vault, streaming SSE relay, multi-provider compatibility layer, SLA monitoring.
