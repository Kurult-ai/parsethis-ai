/**
 * Label a prospect run's own artifacts, so the funnel stays readable.
 *
 *   npx tsx scripts/prospect-run.mts start <slug>   # BEFORE the walkthrough
 *   npx tsx scripts/prospect-run.mts status         # what would be labelled
 *   npx tsx scripts/prospect-run.mts label          # END OF EVERY RUN
 *   npx tsx scripts/prospect-run.mts label --dry-run
 *
 * A prospect run is the operator's own testing, but the whole method depends on
 * the persona behaving like a genuine stranger — so it names its keys the way a
 * real integrator would (`my-agent-prod`, `acme-staging`, `eval-contract`).
 * Those names are deliberately NOT matched by lib/synthetic-keys.ts, because
 * that classifier refuses to guess: wrongly excluding a real customer from your
 * own view of the business is the worse error.
 *
 * The consequence, measured 2026-08-17: roughly 56 keys of unknown provenance
 * sitting in the "real" bucket, all of them artifacts of past runs, making the
 * real signup count an upper bound nobody could tighten. That noise is part of
 * why a completely closed checkout path read as a conversion problem for four
 * days instead of an outage.
 *
 * So: **label after, never during.** During the run Parse must see an ordinary
 * stranger — anything else measures a different product than the one customers
 * meet. Afterwards, the artifacts get marked and the funnel goes back to zero
 * noise. The marker is a timestamp rather than a list of key ids because the
 * persona creates keys ad hoc through curl and the browser, and "remember to
 * write down every key" is precisely the instruction that was never followed.
 *
 * Two guards, because this writes to production:
 *   - A key with a subscription is NEVER labelled. A paying customer is not a
 *     test artifact, whenever they arrived.
 *   - Without a start marker it refuses rather than guessing a window. Guessing
 *     would relabel the whole table.
 */
import "dotenv/config";
import { prisma } from "../src/db.js";
import { getRedis, ensureRedisConnected, isRedisAvailable } from "../src/redis.js";

const MARKER_KEY = "prospect:run:current";
const MARKER_TTL_SECONDS = 30 * 24 * 60 * 60;

interface Marker {
  slug: string;
  startedAt: string;
}

async function redisOrDie() {
  // getRedis() FIRST: isRedisAvailable() reports whether a client has been
  // created, not whether Redis is reachable, and in a standalone script nothing
  // has created one yet. Checking it first makes every script think Redis is
  // down. See the note above isRedisConfigured in src/redis.ts.
  const client = getRedis();
  if (!(await ensureRedisConnected()) || !isRedisAvailable()) {
    console.error("Redis unavailable — the run marker lives there. Start Redis and retry.");
    process.exit(2);
  }
  return client;
}

async function start(slug: string): Promise<void> {
  const redis = await redisOrDie();
  const existing = await redis.get(MARKER_KEY);
  if (existing) {
    const prev = JSON.parse(existing) as Marker;
    console.error(
      `A run is already open: "${prev.slug}" started ${prev.startedAt}.\n` +
      `Run \`label\` to close it before starting another, or the two runs' artifacts merge.`,
    );
    process.exit(1);
  }
  const marker: Marker = { slug, startedAt: new Date().toISOString() };
  await redis.set(MARKER_KEY, JSON.stringify(marker), "EX", MARKER_TTL_SECONDS);
  console.log(`Run "${slug}" started at ${marker.startedAt}.`);
  console.log("Walk the product as the persona. Run `label` when the walkthrough ends.");
}

/** Self-service keys created since the marker that are not yet labelled and are not paying. */
async function candidates(marker: Marker) {
  return prisma.apiKey.findMany({
    where: {
      userId: "self-service",
      synthetic: false,
      createdAt: { gte: new Date(marker.startedAt) },
      // A paying customer is never a test artifact — but "paying" means an
      // ACTIVE subscription, not any subscription row. A coupon run buys a real
      // plan on production and cancels it at teardown, which leaves a canceled
      // row attached to the key forever. Excluding those left every coupon run's
      // key permanently in the customer bucket, which is the exact pollution
      // this script exists to prevent (verified: run 8's Team purchase is still
      // sitting there unlabelled). If teardown failed and the plan is still
      // active, the key is left alone — erring toward not labelling.
      OR: [
        { subscription: null },
        { subscription: { status: { not: "active" } } },
      ],
    },
    select: { id: true, name: true, tier: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

async function readMarker(): Promise<Marker> {
  const redis = await redisOrDie();
  const raw = await redis.get(MARKER_KEY);
  if (!raw) {
    console.error(
      "No open run marker. Refusing to guess a window — that would relabel every key.\n" +
      "If a run happened without `start`, label its keys by hand:\n" +
      "  UPDATE api_keys SET synthetic = true WHERE id IN (...);",
    );
    process.exit(1);
  }
  return JSON.parse(raw) as Marker;
}

async function status(): Promise<void> {
  const marker = await readMarker();
  const rows = await candidates(marker);
  console.log(`Run "${marker.slug}" open since ${marker.startedAt}`);
  console.log(`${rows.length} unlabelled self-service key(s) created since:`);
  for (const r of rows) console.log(`  ${r.createdAt.toISOString()}  ${r.tier.padEnd(6)}  ${r.name}`);
  const paying = await prisma.apiKey.count({
    where: {
      userId: "self-service",
      createdAt: { gte: new Date(marker.startedAt) },
      subscription: { status: "active" },
    },
  });
  if (paying > 0) {
    console.log(`(${paying} key(s) on an ACTIVE plan are excluded and will never be labelled.`);
    console.log(` If that is a coupon purchase, run the coupon teardown first, then label.)`);
  }
}

async function label(dryRun: boolean): Promise<void> {
  const marker = await readMarker();
  const rows = await candidates(marker);

  if (rows.length === 0) {
    console.log(`Run "${marker.slug}": nothing to label.`);
  } else {
    console.log(`Run "${marker.slug}" — ${dryRun ? "would label" : "labelling"} ${rows.length} key(s) synthetic:`);
    for (const r of rows) console.log(`  ${r.name}`);
    if (!dryRun) {
      const res = await prisma.apiKey.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { synthetic: true },
      });
      console.log(`Labelled ${res.count}.`);
    }
  }

  if (dryRun) {
    console.log("\nDry run — marker left open. Re-run without --dry-run to apply.");
    return;
  }

  const redis = await redisOrDie();
  await redis.del(MARKER_KEY);
  console.log(`Run "${marker.slug}" closed.`);
}

const [command, argument] = process.argv.slice(2);
const dryRun = process.argv.includes("--dry-run");

const task =
  command === "start" ? (argument ? start(argument) : Promise.reject(new Error("usage: start <slug>")))
  : command === "status" ? status()
  : command === "label" ? label(dryRun)
  : Promise.reject(new Error("usage: prospect-run.mts start <slug> | status | label [--dry-run]"));

task
  .then(async () => { await prisma.$disconnect().catch(() => {}); process.exit(0); })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
