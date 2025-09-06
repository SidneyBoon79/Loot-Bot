// commands/winner.mjs
// Zeigt pro Item den letzten/aktuellen Gewinner (letzte 48h), kompakt & ephemeral.
// Namen: bevorzugt aus votes (48h), sonst aus wins, sonst slug. Zusätzlich Grund (gear/trait/litho).

export const name = "winner";
export const description = "Aktuelle Gewinner je Item (48h, kompakt)";

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) {
      return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });
    }

    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ??
      ctx.guild?.id ??
      null;

    if (!guildId) {
      return ctx.reply("❌ Konnte die Guild-ID nicht ermitteln.", {
        ephemeral: true,
      });
    }

    // Pro Item den neuesten Gewinner der letzten 48h holen.
    // Namen zuerst aus votes(48h), sonst aus wins (beliebig aktuell), sonst slug.
    const { rows } = await db.query(
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
      names_votes AS (
        SELECT item_slug, MIN(item_name_first) AS item_name, MIN(reason) AS reason
        FROM votes
        WHERE guild_id   = $1
          AND created_at > NOW() - INTERVAL '48 hours'
        GROUP BY item_slug
      ),
      names_wins AS (
        SELECT item_slug, MAX(item_name_first) AS item_name, MAX(reason) AS reason
        FROM wins
        WHERE guild_id = $1
        GROUP BY item_slug
      )
      SELECT
        lw.item_slug,
        lw.user_id,
        lw.won_at,
        COALESCE(nv.item_name, nw.item_name, lw.item_slug) AS item_name,
        COALESCE(nv.reason, nw.reason, '') AS reason
      FROM latest_winners lw
      LEFT JOIN names_votes nv USING (item_slug)
      LEFT JOIN names_wins   nw USING (item_slug)
      ORDER BY lw.won_at DESC
      `,
      [guildId]
    );

    if (!rows?.length) {
      return ctx.reply("📭 Keine Gewinner in den letzten 48 Stunden.", {
        ephemeral: true,
      });
    }

    const fmtReason = (r) => (r === "gear" ? "Gear" : r === "trait" ? "Trait" : r === "litho" ? "Litho" : null);

    const lines = rows.map((r) => {
      const reason = fmtReason(r.reason);
      const suffix = reason ? ` — ${reason}` : "";
      return `• **${r.item_name}** → <@${r.user_id}>${suffix}`;
    });

    return ctx.reply(`🏆 **Gewinner (letzte 48h)**\n${lines.join("\n")}`, {
      ephemeral: true,
    });
  } catch (e) {
    console.error("[commands/winner] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /winner.", { ephemeral: true });
  }
}

export default { name, description, run };
