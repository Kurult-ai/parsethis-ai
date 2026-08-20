import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The hero shop window is only rendered when a demo key is configured.
process.env.DEMO_API_KEY = process.env.DEMO_API_KEY || "test-demo-key-for-hero-contract";

const { formatHeroScreenResult, HERO_ENGINE_NOTE } = await import("./landing-hero-verdict.js");
const { renderLandingPage } = await import("./landing.js");

describe("formatHeroScreenResult — the shipped hero contract", () => {
  it("names a block as Refused", () => {
    const view = formatHeroScreenResult({
      suggested_action: "block",
      risk_score: 9,
      verdict: "critical",
      flags: [{ matched_token: "ignore previous", category: "prompt_injection" }],
    });
    assert.equal(view.label, "Refused");
    assert.equal(view.tone, "refused");
    assert.match(view.why, /ignore previous/);
  });

  it("names sandbox and request_owner_approval as Held for review, not Allowed", () => {
    for (const action of ["sandbox", "request_owner_approval"] as const) {
      const view = formatHeroScreenResult({
        suggested_action: action,
        risk_score: 6,
        verdict: "medium_risk",
        flags: [{ category: "indirect_injection" }],
      });
      assert.equal(view.label, "Held for review", `${action} must not render as Allowed`);
      assert.equal(view.tone, "held");
      assert.notEqual(view.color, "#8ff0b0");
    }
  });

  it("names allow as Allowed", () => {
    const view = formatHeroScreenResult({
      suggested_action: "allow",
      risk_score: 0,
      verdict: "safe",
      flags: [],
    });
    assert.equal(view.label, "Allowed");
    assert.equal(view.tone, "allowed");
    assert.match(view.why, /Nothing flagged/);
  });

  it("says Flagged: <category> when a flag has no matched_token", () => {
    const view = formatHeroScreenResult({
      suggested_action: "sandbox",
      risk_score: 6,
      flags: [{ category: "indirect_injection" }],
    });
    assert.equal(view.why, "Flagged: indirect_injection");
    assert.doesNotMatch(view.why, /Nothing flagged/);
  });

  it("names the engine and the mode", () => {
    const view = formatHeroScreenResult({ suggested_action: "allow" });
    assert.equal(view.engine, HERO_ENGINE_NOTE);
    assert.match(view.engine, /pattern-only/);
    assert.match(view.engine, /deterministic layer only/);
    assert.match(view.engine, /Also run the semantic layer/);
  });

  it("names the full pipeline when layers.llm ran", () => {
    const view = formatHeroScreenResult({
      suggested_action: "block",
      layers: { llm: "ran" },
    });
    assert.match(view.engine, /mode: full/);
    assert.match(view.engine, /full pipeline/);
  });
});

describe("the rendered landing hero script keeps the contract", () => {
  const html = renderLandingPage("https://www.parsethis.ai");
  const script = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .map((m) => m[2])
    .find((body) => body.includes("hero-screen"));

  it("is present", () => {
    assert.ok(script, "expected the hero screening script on the landing page");
  });

  it("keys the verdict on suggested_action, not score >= 7", () => {
    assert.match(script!, /suggested_action/);
    assert.match(script!, /flags\.length/);
    assert.doesNotMatch(
      script!,
      /var refused = score >= 7/,
      "score >= 7 must not decide the verdict label",
    );
    assert.doesNotMatch(
      script!,
      /refused \? 'Refused' : 'Allowed'/,
      "a hold must not collapse into Allowed",
    );
  });

  it("renders three named states", () => {
    assert.match(script!, /Refused/);
    assert.match(script!, /Held for review/);
    assert.match(script!, /Allowed/);
  });

  it("never says Nothing flagged when a flag is present without a token", () => {
    assert.match(script!, /Flagged:/);
  });

  it("labels the engine and names the mode", () => {
    assert.match(script!, /deterministic layer only/);
    assert.match(script!, /pattern-only/);
  });

  it("wires a visible full-mode toggle instead of hardcoding pattern-only", () => {
    assert.match(html, /id="hero-full-mode"/);
    assert.match(script!, /hero-full-mode/);
    assert.match(script!, /wantsFull \? 'full' : 'pattern-only'/);
    assert.doesNotMatch(
      script!,
      /JSON\.stringify\(\{ prompt: text, mode: 'pattern-only', source: 'hero' \}\)/,
    );
  });

  it("parses as a script", () => {
    assert.doesNotThrow(() => new Function(script!));
  });

  it("a sandbox response renders as Held for review, not Allowed", async () => {
    const start = script!.indexOf("(function () {\n  var btn = document.getElementById('hero-screen')");
    const end = script!.indexOf("})();\n\n</script>") > 0
      ? script!.indexOf("})();\n", start) + 5
      : script!.indexOf("})();", start) + 5;
    const heroIife = start >= 0 ? script!.slice(start, end) : "";
    assert.match(heroIife, /hero-screen/);
    const els: Record<string, { textContent: string; style: Record<string, string>; disabled?: boolean; value?: string; placeholder?: string; checked?: boolean }> = {
      "hero-screen": { textContent: "", style: {}, disabled: false },
      "hero-input": { textContent: "", style: {}, value: "hidden instruction in an HTML comment", placeholder: "" },
      "hero-status": { textContent: "", style: {} },
      "hero-result": { textContent: "", style: { display: "none" } },
      "hero-verdict": { textContent: "", style: {} },
      "hero-score": { textContent: "", style: {} },
      "hero-why": { textContent: "", style: {} },
      "hero-engine": { textContent: "", style: {} },
      "hero-ask": { textContent: "", style: { display: "none" } },
      "hero-full-mode": { textContent: "", style: {}, checked: false },
    };
    const document: { getElementById: (id: string) => unknown; click?: () => void } = {
      getElementById: (id: string) => {
        const el = els[id];
        if (!el) return null;
        return Object.assign(el, {
          addEventListener: (_type: string, handler: () => void) => {
            if (id === "hero-screen") document.click = handler;
          },
        });
      },
    };
    const fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        suggested_action: "sandbox",
        recommended_action: "sandbox",
        risk_score: 6,
        verdict: "medium_risk",
        flags: [{ category: "indirect_injection" }],
        latency_ms: 4,
      }),
    });
    const run = new Function("document", "fetch", heroIife);
    run(document, fetch);
    assert.equal(typeof (document as { click?: () => void }).click, "function");
    const click = document.click;
    assert.equal(typeof click, "function");
    await Promise.resolve(click!());
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(els["hero-verdict"].textContent, "Held for review");
    assert.notEqual(els["hero-verdict"].style.color, "#8ff0b0");
    assert.match(els["hero-why"].textContent, /Flagged: indirect_injection/);
  });
});
