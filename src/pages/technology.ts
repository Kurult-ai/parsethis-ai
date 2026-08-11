import { renderPage } from "../lib/html-template.js";
import { organizationSchema, breadcrumbSchema, webAPISchema } from "../lib/schema.js";
import { LATENCY_FACTS, PRODUCT, X402_PAYMENT } from "../lib/product-facts.js";

export function renderTechnologyPage(baseUrl: string): string {
  const content = `
<style>
.tech-shell{display:grid;gap:64px;}
.tech-hero{display:grid;grid-template-columns:minmax(0,0.86fr) minmax(500px,1.14fr);gap:48px;align-items:center;min-height:0;padding:10px 0 8px;}
.tech-hero h1{font-size:clamp(48px,7vw,88px);line-height:0.94;letter-spacing:-0.06em;margin:0 0 22px;}
.tech-lede{font-size:18px;line-height:1.65;color:var(--text-dim);max-width:680px;margin:0 0 28px;}
.tech-actions{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 28px;}
.tech-signals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;max-width:650px;}
.tech-signal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:13px 14px;}
.tech-label,.tech-signal span,.tech-mini-label{display:block;font-size:10px;font-weight:800;letter-spacing:0.11em;text-transform:uppercase;color:var(--text-soft);margin-bottom:5px;}
.tech-signal strong{display:block;font-size:14px;line-height:1.25;}
.tech-console{background:#10141a;color:#f7fbff;border:1px solid #202a35;border-radius:14px;box-shadow:0 28px 70px rgba(18,28,40,0.18);overflow:hidden;}
.tech-console-top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 16px;border-bottom:1px solid #202a35;background:#151b23;}
.tech-console-title{font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;}
.tech-status{display:inline-flex;align-items:center;gap:7px;color:#9af2c1;font-size:12px;font-weight:700;}
.tech-status::before{content:"";width:8px;height:8px;border-radius:999px;background:#37d98b;box-shadow:0 0 0 5px rgba(55,217,139,0.14);}
.tech-flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:12px;align-items:stretch;padding:16px;}
.tech-node{background:#171f29;border:1px solid #263342;border-radius:10px;padding:14px;min-height:136px;}
.tech-node h3{margin:0 0 9px;color:#f7fbff;font-size:14px;letter-spacing:0;}
.tech-node p{margin:0;color:#aab7c5;font-size:13px;line-height:1.5;}
.tech-node code{display:inline-block;margin-top:13px;background:#0b1118;color:#b8cdf7;border:1px solid #263342;}
.tech-arrow{display:flex;align-items:center;color:#6f859d;font-weight:800;}
.tech-decision{border-color:rgba(55,217,139,0.42);box-shadow:inset 0 0 0 1px rgba(55,217,139,0.08);}
.tech-meter{height:8px;border-radius:999px;background:#263342;overflow:hidden;margin:13px 0 12px;}
.tech-meter span{display:block;width:84%;height:100%;background:#e06b5d;}
.tech-console-log{border-top:1px solid #202a35;padding:0 18px 18px;}
.tech-log-row{display:grid;grid-template-columns:96px 1fr auto;gap:12px;align-items:center;border-top:1px solid #202a35;padding:8px 0;color:#aab7c5;font-size:12px;}
.tech-log-row strong{color:#f7fbff;font-weight:700;}
.tech-section{display:grid;grid-template-columns:minmax(240px,0.42fr) minmax(0,1fr);gap:44px;align-items:start;}
.tech-section h2{font-size:clamp(30px,4vw,48px);line-height:1;letter-spacing:-0.045em;margin:0;}
.tech-section-intro{color:var(--text-dim);font-size:16px;line-height:1.65;margin:14px 0 0;max-width:430px;}
.tech-layer-list{display:grid;gap:10px;}
.tech-layer{display:grid;grid-template-columns:190px 1fr;gap:18px;align-items:start;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;}
.tech-layer strong{font-size:14px;}
.tech-layer p{margin:0;color:var(--text-dim);font-size:13px;line-height:1.5;}
.tech-threat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
.tech-threat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:17px;min-height:148px;}
.tech-threat h3{font-size:16px;margin:0 0 8px;}
.tech-threat p{font-size:13px;line-height:1.5;color:var(--text-dim);margin:0 0 13px;}
.tech-category{font-family:var(--mono);font-size:11px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:5px 7px;color:var(--accent2);white-space:nowrap;}
.tech-review{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:18px;align-items:stretch;}
.tech-schema,.tech-panel,.tech-disclosure,.tech-final{background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);}
.tech-schema{overflow:hidden;}
.tech-schema-head{display:flex;justify-content:space-between;gap:16px;align-items:center;background:var(--surface2);border-bottom:1px solid var(--border);padding:13px 16px;}
.tech-schema-title{font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-dim);}
.tech-schema pre{margin:0;padding:18px;white-space:pre-wrap;word-break:break-word;font:13px/1.7 var(--mono);background:#10141a;color:#dbe9f8;border:0;border-radius:0;}
.tech-schema pre code{display:block;padding:0;background:transparent;border:0;border-radius:0;color:#dbe9f8;font:inherit;line-height:inherit;overflow:visible;}
.tech-panel{padding:20px;}
.tech-panel h3{margin-top:0;}
.tech-checklist{list-style:none;padding:0;margin:0;display:grid;gap:11px;}
.tech-checklist li{margin:0;padding-left:22px;position:relative;color:var(--text-dim);font-size:14px;line-height:1.45;}
.tech-checklist li::before{content:"";position:absolute;left:0;top:0.54em;width:9px;height:9px;border-radius:50%;background:var(--accent);}
.tech-note{border-left:3px solid var(--accent);padding:12px 14px;background:var(--surface2);border-radius:0 var(--radius) var(--radius) 0;color:var(--text-dim);font-size:13px;line-height:1.5;margin-top:18px;}
.tech-lanes{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;}
.tech-lane{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;min-height:184px;}
.tech-lane h3{font-size:17px;margin-top:0;}
.tech-lane p{font-size:13px;color:var(--text-dim);}
.tech-lane code{font-size:11px;}
.tech-evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
.tech-evidence-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;min-height:142px;}
.tech-evidence-card strong{display:block;font-size:34px;line-height:1;letter-spacing:-0.04em;margin:9px 0 10px;color:var(--text);}
.tech-evidence-card p{margin:0;color:var(--text-dim);font-size:13px;line-height:1.45;}
.tech-evidence-note{grid-column:1/-1;background:#10141a;color:#dbe9f8;border:1px solid #202a35;border-radius:14px;padding:18px;}
.tech-evidence-note strong{display:block;color:#f7fbff;font-size:15px;margin-bottom:8px;}
.tech-evidence-note p{margin:0;color:#aab7c5;font-size:13px;line-height:1.55;}
.tech-evidence-note code{background:#0b1118;color:#b8cdf7;border:1px solid #263342;white-space:normal;word-break:break-all;}
.tech-disclosure{overflow:hidden;}
.tech-disclosure table{margin:0;}
.tech-disclosure th{position:static;}
.tech-disclosure td{vertical-align:top;}
.tech-disclosure td:first-child{font-weight:650;color:var(--text);}
.tech-inline-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px;}
.tech-final{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;padding:32px;margin-bottom:8px;}
.tech-final h2{font-size:clamp(30px,4vw,52px);margin:0;}
.tech-final p{margin:10px 0 0;color:var(--text-dim);}
@media (max-width:980px){
  .tech-hero,.tech-section,.tech-review,.tech-final{grid-template-columns:1fr;}
  .tech-flow{grid-template-columns:1fr;}
  .tech-arrow{justify-content:center;transform:rotate(90deg);}
  .tech-lanes{grid-template-columns:repeat(2,minmax(0,1fr));}
}
@media (max-width:640px){
  .tech-shell{gap:58px;}
  .tech-hero{padding-top:18px;min-height:0;}
  .tech-hero h1{font-size:48px;}
  .tech-signals,.tech-threat-grid,.tech-lanes,.tech-evidence-grid{grid-template-columns:1fr;}
  .tech-evidence-note{grid-column:auto;}
  .tech-layer{grid-template-columns:1fr;gap:8px;}
  .tech-log-row{grid-template-columns:1fr;gap:3px;}
  .tech-final{padding:22px;}
}
</style>

<div class="tech-shell">
  <section class="tech-hero">
    <div>
      <h1>Technology</h1>
      <p class="tech-lede">Parse screens untrusted text at agent trust boundaries before it can reach tools, memory, credentials, payments, code execution, or users.</p>
      <div class="tech-actions">
        <a href="/docs/api" class="btn btn-primary">Read the API docs</a>
        <a href="/playground" class="btn btn-outline">Run the playground</a>
      </div>
      <div class="tech-signals" aria-label="Screening surfaces">
        <div class="tech-signal"><span>Inputs</span><strong>User prompts, RAG, email, browser pages</strong></div>
        <div class="tech-signal"><span>Decisions</span><strong>allow, sandbox, block, or owner approval</strong></div>
        <div class="tech-signal"><span>Evidence</span><strong>16,250 frozen synthetic candidate rows</strong></div>
      </div>
    </div>

    <div class="tech-console" aria-label="Trust boundary screening preview">
      <div class="tech-console-top">
        <div class="tech-console-title">Trust boundary screening</div>
        <div class="tech-status">decision ready</div>
      </div>
      <div class="tech-flow">
        <div class="tech-node">
          <span class="tech-label">Untrusted source</span>
          <h3>Tool result</h3>
          <p>External text asks the agent to treat data as a higher-priority instruction.</p>
          <code>source: browser</code>
        </div>
        <div class="tech-arrow">-&gt;</div>
        <div class="tech-node tech-decision">
          <span class="tech-label">Parse decision</span>
          <h3>normalize, detect, score</h3>
          <div class="tech-meter"><span></span></div>
          <p>risk_score 8.4, verdict high_risk, suggested_action block</p>
          <code>POST /v1/parse</code>
        </div>
        <div class="tech-arrow">-&gt;</div>
        <div class="tech-node">
          <span class="tech-label">Host action</span>
          <h3>Act on policy</h3>
          <p>The host keeps retrieved content as data and prevents it from steering tools.</p>
          <code>trace_id: prs_7fd2</code>
        </div>
      </div>
      <div class="tech-console-log">
        <div class="tech-log-row"><span>public field</span><strong>risk_score</strong><span>0-10</span></div>
        <div class="tech-log-row"><span>public field</span><strong>attack_detected</strong><span>true</span></div>
        <div class="tech-log-row"><span>public field</span><strong>decision.action</strong><span>block</span></div>
      </div>
    </div>
  </section>

  <section class="tech-section">
    <div>
      <h2>How the detector works.</h2>
      <p class="tech-section-intro">Parse uses layered screening so hosts can make a practical allow, sandbox, approval, or block decision without exposing the internal detector recipe.</p>
    </div>
    <div class="tech-layer-list">
      <div class="tech-layer"><strong>Deterministic signals</strong><p>Fast public-category checks catch known instruction override, extraction, and boundary manipulation patterns.</p></div>
      <div class="tech-layer"><strong>Structural analysis</strong><p>Normalization and content-shape checks help spot encoded, hidden, or tool-shaped text trying to gain authority.</p></div>
      <div class="tech-layer"><strong>Semantic review</strong><p>When configured and useful, semantic analysis evaluates ambiguous text in context before a host acts.</p></div>
      <div class="tech-layer"><strong>Isolated sandbox</strong><p>Suspicious workflows can be isolated so the host observes behavior without giving the text real authority.</p></div>
    </div>
  </section>

  <section class="tech-section">
    <div>
      <h2>Current evidence state.</h2>
      <p class="tech-section-intro">The latest internal candidate freeze is now large enough for serious regression work, but it is intentionally not presented as public claimable evidence.</p>
      <div class="tech-inline-actions">
        <a href="/security/limitations" class="btn btn-primary">Read limitations</a>
        <a href="/docs/risk-categories" class="btn btn-outline">Risk taxonomy</a>
      </div>
    </div>
    <div class="tech-evidence-grid" aria-label="Current screening evidence results">
      <div class="tech-evidence-card">
        <span class="tech-mini-label">Synthetic candidate corpus</span>
        <strong>16,250</strong>
        <p>Schema-valid JSONL rows frozen for internal Hermes/runtime evidence hygiene.</p>
      </div>
      <div class="tech-evidence-card">
        <span class="tech-mini-label">Batch files</span>
        <strong>65</strong>
        <p>Recursive intake audit passed with zero validation errors and zero duplicate prompts or IDs.</p>
      </div>
      <div class="tech-evidence-card">
        <span class="tech-mini-label">Hard-negative workflows</span>
        <strong>5,250</strong>
        <p>Benign agent workflow rows now clear the 5,000-row internal SOTA-style scale gate.</p>
      </div>
      <div class="tech-evidence-card">
        <span class="tech-mini-label">Claimable rows</span>
        <strong>0</strong>
        <p>No public claimable row is counted until independent provenance, human review, detector lock, and CI-backed evaluation pass.</p>
      </div>
      <div class="tech-evidence-note">
        <strong>Status: pass_candidate_non_claimable</strong>
        <p>Stable row hash <code>cda6d75e25f729ff3273f8041b9ef4a121c493ab1d5e127db3ca5e028e4dfcb0</code>. Remaining blockers: blind human/adversarial review, independent provenance, detector/config lock, confidence intervals, and no-post-freeze tuning proof.</p>
      </div>
    </div>
  </section>

  <section class="tech-section">
    <div>
      <h2>What Parse looks for.</h2>
      <p class="tech-section-intro">The public taxonomy is intentionally stable and implementation-neutral. It tells developers what kind of risk was found without publishing bypass recipes.</p>
    </div>
    <div class="tech-threat-grid">
      <div class="tech-threat"><h3>Instruction override</h3><p>Text that tries to replace the agent's real task, hierarchy, or operating constraints.</p><span class="tech-category">prompt_injection</span></div>
      <div class="tech-threat"><h3>System prompt extraction</h3><p>Requests to reveal hidden instructions, protected prompts, private policy, or developer messages.</p><span class="tech-category">system_prompt_leak</span></div>
      <div class="tech-threat"><h3>Tool misuse</h3><p>Attempts to steer browser, HTTP, filesystem, payment, or execution tools outside the intended workflow.</p><span class="tech-category">privilege_escalation</span></div>
      <div class="tech-threat"><h3>Data exfiltration</h3><p>Attempts to send secrets, private context, customer data, or owner details to an untrusted party.</p><span class="tech-category">data_exfiltration</span></div>
      <div class="tech-threat"><h3>Hidden content</h3><p>Instructions hidden inside documents, pages, markup, structured fields, or tool output metadata.</p><span class="tech-category">indirect_injection</span></div>
      <div class="tech-threat"><h3>Agent spoofing</h3><p>Messages that claim false identity, authority, urgency, or delegation rights from another agent.</p><span class="tech-category">social_engineering</span></div>
    </div>
  </section>

  <section class="tech-section">
    <div>
      <h2>Designed for developer review.</h2>
      <p class="tech-section-intro">Parse returns machine-readable fields that are easy to log, test, route, and explain during integration review.</p>
      <div class="tech-inline-actions">
        <a href="/docs/api" class="btn btn-primary">API reference</a>
        <a href="/security/limitations" class="btn btn-outline">Security limitations</a>
      </div>
    </div>
    <div class="tech-review">
      <div class="tech-schema">
        <div class="tech-schema-head">
          <div class="tech-schema-title">Response shape</div>
          <code>application/json</code>
        </div>
        <pre><code>{
  "risk_score": 8.4,
  "verdict": "high_risk",
  "attack_detected": true,
  "policy_violation": true,
  "owner_approval_required": false,
  "categories": ["prompt_injection", "indirect_injection"],
  "flags": [
    {
      "type": "prompt_injection",
      "severity": "high",
      "description": "Untrusted text attempted to override host instructions."
    }
  ],
  "recommended_action": "block",
  "suggested_action": "block",
  "decision": {
    "action": "block",
    "basis": "attack_detected",
    "confidence": "high"
  },
  "trace_id": "prs_7fd2",
  "latency_ms": 1800
}</code></pre>
      </div>
      <div class="tech-panel">
        <h3>Deployment expectations</h3>
        <ul class="tech-checklist">
          <li>Call before untrusted text gains authority.</li>
          <li>Fail closed on high-impact paths.</li>
          <li>Keep tools and credentials least-privilege.</li>
          <li>Log <code>trace_id</code> for incident review.</li>
          <li>Test the same boundary in the playground.</li>
          <li>Parse runs hosted &mdash; there is no on-premises or air-gapped build. If prompt text cannot leave your network, use the open-source <code>prompt-guard</code> library instead; <code>mode: "pattern-only"</code> keeps text away from the semantic-analysis provider but still sends it to Parse. <a href="/faq">Details</a>.</li>
        </ul>
        <div class="tech-note">Detection reduces risk; it does not replace permissions, output validation, or review.</div>
      </div>
    </div>
  </section>

  <section class="tech-section">
    <div>
      <h2>How to integrate it.</h2>
      <p class="tech-section-intro">Use the surface that matches your agent runtime. The security decision stays the same: screen before authority.</p>
    </div>
    <div class="tech-lanes">
      <div class="tech-lane"><span class="tech-mini-label">Input</span><h3>Prompt screening</h3><p>Screen untrusted text before tools, memory, credentials, payments, code, or users.</p><code>POST /v1/parse</code></div>
      <div class="tech-lane"><span class="tech-mini-label">Output</span><h3>Output screening</h3><p>Screen generated or tool-derived output before forwarding it to another boundary.</p><code>POST /v1/screen-output</code></div>
      <div class="tech-lane"><span class="tech-mini-label">Agent tools</span><h3>Hosted MCP</h3><p>Expose prompt screening, output screening, trust verification, and pricing discovery.</p><code>POST /mcp</code></div>
      <div class="tech-lane"><span class="tech-mini-label">Payment</span><h3>x402 pay-per-call</h3><p>Let autonomous agents pay with ${X402_PAYMENT.currency} on ${X402_PAYMENT.networkName} when no account exists.</p><code>GET /v1/pricing</code></div>
    </div>
  </section>

  <section class="tech-section">
    <div>
      <h2>What we disclose publicly.</h2>
      <p class="tech-section-intro">Good security products should be understandable without publishing the recipe attackers or competitors need.</p>
    </div>
    <div class="tech-disclosure table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Public</th>
            <th>Kept internal</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Risk categories</td>
            <td>Detector internals</td>
            <td>Developers need stable labels, not a map for bypassing detection.</td>
          </tr>
          <tr>
            <td>Response fields</td>
            <td>Scoring weights</td>
            <td>Hosts need clear actions while scoring remains adaptable.</td>
          </tr>
          <tr>
            <td>Playground fixtures</td>
            <td>Synthetic candidate corpus before review</td>
            <td>Internal rows improve regression coverage, but they are not public proof until claimability gates pass.</td>
          </tr>
          <tr>
            <td>Limitations</td>
            <td>Bypass recipes</td>
            <td>Honest boundaries improve integrations; exploit instructions do not.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="tech-final">
    <div>
      <h2 id="latency">Measured latency.</h2>
      <p class="tech-section-intro">Two screening modes with distinct latency profiles.</p>
    </div>
    <div class="tech-grid">
      <div class="tech-panel">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>Mode</th><th>Detection</th><th>End-to-end<sup>*</sup></th><th>Prompt text leaves Parse?</th></tr>
            </thead>
            <tbody>
              <tr><td><strong>Pattern-only</strong></td><td>${LATENCY_FACTS.detection.patternOnly.sampleMs[0]}&ndash;${LATENCY_FACTS.detection.patternOnly.sampleMs[1]}&nbsp;ms</td><td>~${LATENCY_FACTS.endToEnd.patternOnly.priorP50Ms}&nbsp;ms<sup>*</sup></td><td>No</td></tr>
              <tr><td><strong>Full</strong> (pattern + semantic)</td><td>seconds (model call)</td><td>~${(LATENCY_FACTS.endToEnd.full.priorRangeMs[0] / 1000).toLocaleString("en-US")}&ndash;${(LATENCY_FACTS.endToEnd.full.priorRangeMs[1] / 1000).toLocaleString("en-US")}&nbsp;s<sup>*</sup></td><td>Yes (to OpenRouter)</td></tr>
            </tbody>
          </table>
        </div>
        <p><em>Detection</em> is the time Parse spends deciding — the <code>latency_ms</code> field in every response, and the number to trust because you can read it on your own traffic. The pattern-only figures are a small number of point samples, not fitted percentiles. <em>End-to-end</em> is what your client waits, including TLS, our edge and tunnel, authentication and serialization.</p>
        <p class="tech-note"><sup>*</sup> End-to-end figures are caller-measured against production and provisional &mdash; a small sample, not a fitted distribution. Most of that time is not detection: an unauthenticated health check returns in well under a tenth of the pattern-only figure, and the remainder sits on our authentication path, which we are working on. We will publish firm percentiles when we have a real distribution to publish. Budget against the end-to-end column, and measure your own path before committing to a latency budget. Full mode also varies with model provider response time.</p>
        <div class="tech-note">For hot-path screening, use <code>mode: "pattern-only"</code>. For batch analysis, use full mode.</div>
      </div>
    </div>
  </section>

  <section class="tech-section tech-cta">
    <div>
      <h2>Build with a clear trust boundary.</h2>
      <p>Use Parse where untrusted text is about to gain authority.</p>
    </div>
    <div class="tech-actions" style="margin:0;">
      <a href="/docs/quickstart" class="btn btn-primary">Start with quickstart</a>
      <a href="/playground" class="btn btn-outline">Open playground</a>
    </div>
  </section>
</div>
`;

  return renderPage({
    title: "Technology",
    description:
      "How Parse screens untrusted text at agent trust boundaries with layered prompt detection, public risk categories, and developer-friendly response fields.",
    path: "/technology",
    content,
    baseUrl,
    lastUpdated: "2026-05-05T14:30:00-04:00",
    jsonLd: [
      organizationSchema(baseUrl),
      webAPISchema(baseUrl),
      breadcrumbSchema([
        { name: "Home", url: `${baseUrl}/` },
        { name: "Technology", url: `${baseUrl}/technology` },
      ]),
    ],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Technology", href: "/technology" },
    ],
  });
}
