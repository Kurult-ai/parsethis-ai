/**
 * Delete records past their stated retention window.
 *
 *   npm run retention:purge -- --dry-run   # report only, delete nothing
 *   npm run retention:purge                # delete
 *
 * The worker runs this daily; this entry point exists so a first run can be
 * inspected before anything is destroyed.
 */
import "dotenv/config";
import { runRetentionPurge } from "../src/lib/retention-purge.js";

const dryRun = process.argv.includes("--dry-run");
const results = await runRetentionPurge({ dryRun });

const totalExpired = results.reduce((sum, r) => sum + r.expired, 0);
const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
const errors = results.filter((r) => r.error);

console.log(
  `\n${dryRun ? "DRY RUN — nothing deleted" : "purge complete"}: ` +
    `${totalExpired} row(s) past retention, ${totalDeleted} deleted`
);
for (const r of results) {
  console.log(
    `  ${r.table.padEnd(22)} keep ${String(r.retentionDays).padStart(3)}d  ` +
      `expired ${String(r.expired).padStart(6)}  deleted ${String(r.deleted).padStart(6)}` +
      (r.truncated ? "  (batch cap hit — run again)" : "") +
      (r.error ? `  ERROR: ${r.error}` : "")
  );
}
if (errors.length > 0) process.exit(1);
