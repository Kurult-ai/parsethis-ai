/**
 * Simple idempotent SQL migration runner.
 * Applies *.sql files from prisma/migrations/ in sorted order,
 * tracking applied migrations in a _migrations table.
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.warn("[migrate] DATABASE_URL not set — skipping migrations");
    return;
  }

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, "../prisma/migrations");
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        "SELECT 1 FROM _migrations WHERE name = $1",
        [file]
      );
      if (rows.length > 0) {
        console.log(`[migrate] skip: ${file}`);
        continue;
      }

      const raw = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      // Strip any non-SQL preamble (e.g. "Loaded Prisma config from ...")
      const sql = raw.replace(/^[^-\s][^\n]*\n/, "").trim();

      console.log(`[migrate] apply: ${file}`);
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    }

    console.log("[migrate] done");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// Run directly if invoked as a script
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations().catch(err => {
    console.error("[migrate] FAILED:", err.message);
    process.exit(1);
  });
}
