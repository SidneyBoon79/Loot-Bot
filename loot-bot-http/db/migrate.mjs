// db/migrate.mjs
// Führt db/schema.sql gegen deine Postgres-DB aus.
// Läuft komplett über process.env.DATABASE_URL (Railway Variables).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL fehlt (Railway Variable).");
    process.exit(1);
  }

  const schemaPath = path.resolve(__dirname, "./schema.sql");
  let sql;
  try {
    sql = await fs.readFile(schemaPath, "utf8");
  } catch (e) {
    console.error("❌ Konnte db/schema.sql nicht lesen:", e.message);
    process.exit(1);
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    // Viele Railway-Postgres-Instanzen wollen SSL
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("✅ Migration erfolgreich ausgeführt.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Migration fehlgeschlagen:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
