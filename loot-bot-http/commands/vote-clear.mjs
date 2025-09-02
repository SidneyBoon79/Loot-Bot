// commands/vote-clear.mjs
// /vote-clear – Hard Reset: löscht Votes, Items & Wins für die aktuelle Guild (Mods only)

export async function run(ctx) {
  // Nur Mods (Manage Server) dürfen das
  ctx.requireMod?.();

  await ensureSchema(ctx.db);

  try {
    const guildId = ctx.guildId;

    // Alles in einer Transaktion, damit der Zustand konsistent bleibt
    await ctx.db.query("BEGIN");

    // Votes löschen (48h-Fenster ist implizit – wir wipen komplett)
    await ctx.db.query(`DELETE FROM votes WHERE guild_id = $1`, [guildId]);

    // Items zurücksetzen (wir entfernen die Register-Einträge komplett;
    // alternativ könnte man nur rolled=false setzen – hier: sauberer Wipe)
    await ctx.db.query(`DELETE FROM items WHERE guild_id = $1`, [guildId]);

    // Wins-Zähler löschen (Debuffs/Markierungen)
    await ctx.db.query(`DELETE FROM wins WHERE guild_id = $1`, [guildId]);

    await ctx.db.query("COMMIT");

    // Öffentliche Bestätigung, damit alle den Reset sehen
    return ctx.reply(
      "🧹 **Reset durchgeführt:** Votes, Items und Wins wurden für diese Guild gelöscht.",
      { ephemeral: false }
    );
  } catch (err) {
    await ctx.db.query("ROLLBACK").catch(() => {});
    console.error("/vote-clear error:", err);
    return ctx.reply("❌ Konnte den Reset nicht durchführen. Versuch’s später erneut.", { ephemeral: true });
  }
}

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      reason     TEXT NOT NULL CHECK (reason IN ('gear','trait','litho')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, user_id, item_name)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS items (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      rolled     BOOLEAN NOT NULL DEFAULT FALSE,
      winner_id  TEXT,
      rolled_by  TEXT,
      rolled_at  TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, item_name)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS wins (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      win_count  INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
  `);
}
