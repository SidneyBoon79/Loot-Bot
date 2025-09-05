// commands/winner.mjs
// Zeigt pro Item den letzten/aktuellen Gewinner innerhalb der letzten 48h (kompakt).
// Antwort ist absichtlich ephemeral (kurzer Überblick für alle).

export const name = "winner";
export const description = "Aktuelle Gewinner je Item (48h, kompakt)";

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;

    if (!guildId) {
      return ctx.reply("❌ Konnte die Guild-ID nicht ermitteln.", { ephemeral: true });
    }

    // 1) Letzten Gewinner je Item aus winners (48h)
    // DISTINCT ON wählt je item_slug den neuesten won_at
    const { rows: latest } = await db.query(
      `
      WITH latest_winners AS (
        SELECT DISTINCT ON (item_slug)
               item_slug,
               user_id,
               won_at
        FROM winners
        WHERE guild_id = $1
          AND won_at   > NOW() - INTERVAL '48 hours'
        ORDER BY item_slug, won_at DESC
      ),
      names AS (
        SELECT item_slug, MIN(item_name_first) AS item_name
        FROM votes
        WHERE guild_id   = $1
          AND created_at > NOW() - INTERVAL '48 hours'
        GROUP BY item_slug
      )
      SELECT lw.item_slug,
             COALESCE(n.item_name, lw.item_slug) AS item_name,
             lw.user_id,
             lw.won_at
      FROM latest_winners lw
      LEFT JOIN names n USING (item_slug)
      ORDER BY lw.won_at DESC
      `,
      [guildId]
    );

    if (!latest?.length) {
      return ctx.reply("📭 Keine Gewinner in den letzten 48 Stunden.", { ephemeral: true });
    }

    const lines = latest.map(r => `• **${r.item_name}** → <@${r.user_id}>`);

    return ctx.reply(`# 🏆 Gewinner (letzte 48h)\n${lines.join("\n")}`, { ephemeral: true });
  } catch (e) {
    console.error("[commands/winner] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /winner.", { ephemeral: true });
  }
}

export default { name, description, run };
