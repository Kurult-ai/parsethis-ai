/**
 * Send the monthly household receipt to paid keys with a real email address.
 *
 * **Dry-run by default. Sending requires `--send`, and that is deliberate.**
 * Scheduled outbound mail to a customer list is hard to reverse — one bad run
 * cannot be recalled — so the switch is explicit, sits outside the code path,
 * and the dry run prints exactly what would go where.
 *
 * Two facts that shape it:
 *
 *  - Most self-service keys have no deliverable address. Their owner is
 *    `self-service@internal.invalid`, which is a sentinel and not a mailbox.
 *    Those keys are skipped and counted, never guessed at.
 *  - Free keys are not mailed at all. The digest is a paid-plan artifact, and
 *    mailing people who never asked for a relationship is how a security
 *    vendor's mail ends up in spam folders.
 *
 * Usage:
 *   npx tsx scripts/send-monthly-digests.mts            # dry run, prints a table
 *   npx tsx scripts/send-monthly-digests.mts --send     # actually sends
 */
import { prisma } from "../src/db.js";
import { buildDigest, categoryInPlainEnglish } from "../src/lib/digest.js";
import { monthlyDigestEmail, sendEmail } from "../src/lib/email.js";

const SEND = process.argv.includes("--send");
const PAID = ["solo", "pro", "team", "compliance", "enterprise"];
const SENTINEL = "self-service@internal.invalid";

function lastMonthWindow(): { start: Date; end: Date; period: string; days: number } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return {
    start,
    end,
    period: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
    days,
  };
}

async function main(): Promise<void> {
  const { start, end, period, days } = lastMonthWindow();
  console.log(`${SEND ? "SENDING" : "DRY RUN"} — monthly digests for ${period}\n`);

  const keys = await prisma.apiKey.findMany({
    where: { tier: { in: PAID }, revokedAt: null },
    select: { id: true, name: true, tier: true, owner: { select: { email: true } } },
  });

  let sent = 0;
  let skippedNoAddress = 0;
  for (const key of keys) {
    const email = key.owner?.email;
    if (!email || email === SENTINEL || !email.includes("@")) {
      skippedNoAddress++;
      continue;
    }

    const events = await prisma.screeningEvent.findMany({
      where: { apiKeyId: key.id, createdAt: { gte: start, lt: end } },
      select: { riskScore: true, verdict: true, categories: true, blocked: true, disposition: true, createdAt: true },
      take: 20_000,
    });
    const digest = buildDigest(events, period, days);
    const mail = monthlyDigestEmail(digest, categoryInPlainEnglish);

    console.log(
      `${email.padEnd(34)} ${String(key.tier).padEnd(6)} `
      + `screened=${String(digest.screened).padStart(6)} refused=${String(digest.refused).padStart(4)}  "${mail.subject}"`,
    );

    if (SEND) {
      const result = await sendEmail({
        to: email,
        subject: mail.subject,
        html: mail.html,
        tags: [{ name: "type", value: "monthly_digest" }],
      });
      if ("error" in result) console.error(`  ! failed for ${email}: ${result.error}`);
      else sent++;
    }
  }

  console.log(
    `\n${keys.length} paid keys · ${skippedNoAddress} skipped with no deliverable address · `
    + (SEND ? `${sent} sent` : "0 sent (dry run — pass --send)"),
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
