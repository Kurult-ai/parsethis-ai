import { renderPage } from "../lib/html-template.js";
import { breadcrumbSchema } from "../lib/schema.js";

/**
 * Founder page — SSR HTML at /founder
 *
 * The raise-facing answer to "who am I sending a wire to?" Run-33's buyer and
 * the advisor review both said the same thing: the trust page proved the
 * product's honesty; the missing piece was the person attached to it. This
 * page is deliberately small — name, place, story, usage-as-usage, and an
 * email a human answers.
 */
export function renderFounderPage(baseUrl: string): string {
  const content = `
<style>
  .founder-hero { padding: 48px 0 32px; border-bottom: 1px solid var(--border); margin-bottom: 32px; }
  .founder-hero h1 { font-size: clamp(32px, 5vw, 48px); line-height: 1.05; letter-spacing: -0.04em; margin: 0 0 16px; max-width: 720px; }
  .founder-hero p { font-size: 18px; line-height: 1.6; color: var(--text-dim); max-width: 640px; margin: 0; }
  .founder-section { padding: 32px 0; border-bottom: 1px solid var(--border); }
  .founder-section:last-child { border-bottom: none; }
  .founder-section h2 { font-size: 24px; line-height: 1.15; letter-spacing: -0.03em; margin: 0 0 14px; }
  .founder-section p { font-size: 16px; line-height: 1.7; color: var(--text-dim); }
  .founder-section p + p { margin-top: 14px; }
  .founder-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin: 20px 0; }
  .founder-fact { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
  .founder-fact strong { display: block; font-size: 15px; margin-bottom: 4px; color: var(--text); }
  .founder-fact span { font-size: 14px; color: var(--text-dim); }
  .founder-email { background: linear-gradient(135deg, var(--accent-dim), transparent); border: 1px solid rgba(0,111,238,0.2); border-radius: var(--radius); padding: 28px; margin-top: 28px; }
  .founder-email a { font-size: 18px; }
</style>

<div class="founder-hero">
  <h1>Daniel Finn builds the gate he wished existed.</h1>
  <p>Founder and operator of Parse. Raleigh, North Carolina. Fintech and regulated systems.</p>
</div>

<section class="founder-section">
  <h2>The short version</h2>
  <p>I ran a fleet of autonomous agents with real authority — they could send mail and spend. The hard part was never making them act; it was proving, after the fact, that every action stayed inside the boundary I set. So I built the quorum they ran under: every decision screened, every action receipted, nothing escaping its gates.</p>
  <p>Parse is that quorum, productized. Not a governance narrative — a gate you can install this afternoon.</p>
</section>

<section class="founder-section">
  <h2>Why you can check my work</h2>
  <p>Parse runs on infrastructure I operate myself. The <a href="/trust">trust page</a> says exactly what that means — single node, where data lives, what is and is not certified — because the honest version of that page is the best diligence I have. I will talk to you after the wire the same way I talked to you before it.</p>
  <div class="founder-facts">
    <div class="founder-fact"><strong>Kurultai Labs LLC</strong><span>North Carolina, USA. Single-founder, no outside money yet.</span></div>
    <div class="founder-fact"><strong>Dogfooded at scale</strong><span>The lab's own fleet screens thousands of tasks through Parse every week. That is usage, not customers.</span></div>
    <div class="founder-fact"><strong>Receipts on everything</strong><span>Every verdict, every policy change, every key event — queryable by the customer, not just the vendor.</span></div>
  </div>
</section>

<section class="founder-section">
  <h2>Talk to a human</h2>
  <div class="founder-email">
    <p>Questions about security, architecture, pricing, or whether Parse fits your agent? I read and answer every message myself, within a day.</p>
    <p><a href="mailto:d@kurult.ai"><strong>d@kurult.ai</strong></a></p>
  </div>
</section>
`;

  return renderPage({
    title: "Founder — Daniel Finn",
    description: "Daniel Finn, Raleigh NC — founder of Parse by Kurultai Labs. Ran governed autonomous agent fleets in regulated industries; built the gate he wished existed. d@kurult.ai, answered within a day.",
    path: "/founder",
    content,
    baseUrl,
    jsonLd: [
      breadcrumbSchema([
        { name: "Home", url: `${baseUrl}/` },
        { name: "Founder", url: `${baseUrl}/founder` },
      ]),
    ],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Founder", href: "/founder" },
    ],
  });
}
