// commands/winner.mjs
// /winner – zeigt eine kompakte Gewinnerliste (Mods only), 48h-Fenster
// Ausgabe (ephemer an den Mod):
// Item — @User (Wins gesamt: n) | gerollt: YYYY-MM-DD HH:MM

export async function run(ctx) {
  ctx.requireMod?.();
  await ensureSchema(ctx.db);

  const guildId = ctx.guildId;

  // Gewinner der letzten 48h: nur Items, die gerollt wurden und einen winner_id haben
  const { rows } = await ctx.db.query(
    `
    SELECT
      i.item_name,
      i.winner_id,
      i.rolled_at,
      COALESCE(w.win_count, 0) AS win_count
    FROM items i
    LEFT JOIN wins w
      ON w.guild_id = i.guild_id AND w.user_id = i.winner_id
    WHERE i.guild_id = $1
      AND i.rolled = TRUE
      AND i.winner_id IS NOT NULL
      AND i.rolled_at > NOW() - INTERVAL '48 hours'
    ORDER BY i.rolled_at DESC, i.item_name ASC
    `,
    [guildId]
  );

  if (!rows.length) {
    return ctx.reply("Keine Gewinner im aktuellen 48h-Fenster.", { ephemeral: true });
  }

  const fmt = (d) => {
    // Einfache UTC→„YYYY-MM-DD HH:MM“ Darstellung; Discord zeigt die Zeit im Client eh lokalisiert an.
    const dt = new Date(d);
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())} UTC`;
    // Wenn du lieber lokale Zeitzone willst, nimm dt.getFullYear() etc.
  };

  const lines = rows.map(r => {
    const mention = `<@${r.winner_id}>`;
    return `${r.item_name} — ${mention} (Wins gesamt: ${r.win_count}) | gerollt: ${fmt(r.rolled_at)}`;
  }).join("\n");

  return ctx.reply(lines, { ephemeral: true });
}

async function ensureSchema(db) {
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

