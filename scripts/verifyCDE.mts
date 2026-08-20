import { renderLandingPage } from "../src/pages/landing.js";
import { renderGetStartedPage } from "../src/pages/get-started.js";
import { renderPricingPage } from "../src/pages/pricing.js";
import { getOgCardJpeg } from "../src/pages/og-card.js";
import { RETENTION } from "../src/lib/retention-facts.js";

const BASE = "https://www.parsethis.ai";
let fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

// --- Part C: the raster card ------------------------------------------------
const jpg = getOgCardJpeg();
check("og card decodes", jpg.length > 50_000, `${jpg.length} bytes`);
check("og card is a JPEG (SOI marker)", jpg[0] === 0xff && jpg[1] === 0xd8);
check("og card ends with EOI marker", jpg[jpg.length - 2] === 0xff && jpg[jpg.length - 1] === 0xd9);

const landing = renderLandingPage(BASE);
check("landing og:image is the raster", landing.includes("/og-image.jpg"));
check("landing no longer points og:image at the SVG",
  !/og:image"\s+content="[^"]*og-image\.svg/.test(landing));
check("landing declares twitter:image", landing.includes('name="twitter:image"'));
check("landing declares image dimensions", landing.includes('og:image:width') && landing.includes('og:image:height'));

const pricing = renderPricingPage(BASE);
check("shared template pages use the raster too", pricing.includes("/og-image.jpg"));
check("summary_large_image still declared", pricing.includes("summary_large_image"));

// --- Part E: one expiry number ---------------------------------------------
const gs = renderGetStartedPage(BASE);
check("get-started states 90 idle days", gs.includes(`${RETENTION.selfServiceKeyExpiryDays} idle days`));
check("get-started no longer says 30 idle days", !gs.includes("30 idle days"));
check("pricing agrees", pricing.includes("90"));

// --- Part D-nav: /personal reachable ---------------------------------------
for (const [name, html] of [["landing", landing], ["pricing", pricing], ["get-started", gs]] as const) {
  check(`${name} links /personal`, html.includes('href="/personal"'));
}

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"}`);
if (fail) process.exit(1);
