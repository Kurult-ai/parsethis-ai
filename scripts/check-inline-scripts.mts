/**
 * Every page's inline <script> must parse. A template literal renders
 * '\\n' as a real newline, which breaks a single-quoted JS string and takes
 * the whole block down with it — invisible to tsc, the tests, and every
 * server-side check, because the artifact is only wrong after rendering.
 *
 * Run 18 exited on exactly this: /demo's Screen Prompt button was dead on
 * production for four days. The landing-only guard that preceded this file
 * could not have caught it. This one renders every public page a stranger can
 * reach and parses each inline script with new Function(), the same check the
 * browser's parser applies.
 */
import { renderLandingPage } from '../src/pages/landing.js';
import { renderDemoPage } from '../src/pages/demo-page.js';
import { renderGetStartedPage } from '../src/pages/get-started.js';
import { renderPricingPage } from '../src/pages/pricing.js';
import { renderPersonalPage } from '../src/pages/personal.js';
import { renderTechnologyPage } from '../src/pages/technology.js';
import { renderFaqPage } from '../src/pages/faq.js';
import { renderBlogListingPage } from '../src/pages/blog.js';
import { renderAboutPage } from '../src/pages/about.js';
import { renderTrustPage } from '../src/pages/trust-page.js';
import { renderTrustPackagePage } from '../src/pages/trust-package.js';
import { renderDpaPage } from '../src/pages/dpa.js';
import { renderSignupPage } from '../src/pages/signup-page.js';
import { renderLoginPage } from '../src/pages/login-page.js';
import { renderInjectionPlaygroundPage } from '../src/pages/playground.js';
import { renderPromptGuardLandingPage } from '../src/pages/prompt-guard-landing.js';
import { renderSupportPage } from '../src/pages/support.js';

const BASE = 'https://www.parsethis.ai';
const pages: [string, string][] = [
  ['/', renderLandingPage(BASE)],
  ['/demo', renderDemoPage(BASE)],
  ['/get-started', renderGetStartedPage(BASE)],
  ['/pricing', renderPricingPage(BASE)],
  ['/personal', renderPersonalPage(BASE)],
  ['/technology', renderTechnologyPage(BASE)],
  ['/faq', renderFaqPage(BASE)],
  ['/blog', renderBlogListingPage(BASE)],
  ['/about', renderAboutPage(BASE)],
  ['/trust', renderTrustPage(BASE)],
  ['/trust-package', renderTrustPackagePage(BASE)],
  ['/dpa', renderDpaPage(BASE)],
  ['/signup', renderSignupPage(BASE)],
  ['/login', renderLoginPage(BASE)],
  ['/playground', renderInjectionPlaygroundPage(BASE)],
  ['/prompt-guard', renderPromptGuardLandingPage(BASE)],
  ['/support', renderSupportPage(BASE)],
];

let totalChecked = 0, totalBad = 0;
for (const [route, html] of pages) {
  const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  let checked = 0, bad = 0;
  for (const [, attrs, body] of blocks) {
    if (/src=/.test(attrs)) continue;
    const type = /type=["']([^"']+)["']/.exec(attrs)?.[1] ?? 'text/javascript';
    if (type.includes('json')) { try { JSON.parse(body); } catch (e) { bad++; console.log(`  ${route} JSON-LD INVALID: ${(e as Error).message}`); } continue; }
    checked++;
    try { new Function(body); } catch (e) { bad++; console.log(`  ${route} JS BLOCK SYNTAX ERROR: ${(e as Error).message}`); }
  }
  totalChecked += checked; totalBad += bad;
  console.log(`${route.padEnd(16)} scripts=${checked} broken=${bad}`);
}
console.log(`\ntotal executable JS blocks: ${totalChecked}, broken: ${totalBad}`);
if (totalBad > 0) process.exit(1);
