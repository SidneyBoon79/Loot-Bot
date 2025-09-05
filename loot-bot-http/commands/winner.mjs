// commands/winner.mjs
// Zeigt pro Item den letzten/aktuellen Gewinner (letzte 48h), kompakt & ephemeral.

import items from "../data/items.json" assert { type: "json" };

export const name = "winner";
export const description = "Aktuelle Gewinner je Item (48h, kompakt)";

function mapNameFromItemsJson(slug) {
  try {
    if (!slug) return null;
    const hit = items.find(
      (it) =>
        String(it.slug || "").toLowerCase() === String(slug || "").toLowerCase()
    );
    return hit?.name_first || hit?.name || null;
  } catch {
    return null;
  }
}

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

    // 1) Pro Item den neuesten Gewinner innerhalb der letzten 48h
    //    DISTINCT ON wählt je item_slug den jüngsten won_at.
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
      names AS (
        SELECT item_slug, MIN(item_name_first) AS item_name
        FROM votes
        WHERE guild_id   = $1
          AND created_at > NOW() - INTERVAL '48 hours'
        GROUP BY item_slug
      )
      SELECT lw.item_slug,
             lw.user_id,
             lw.won_at,
             n.item_name
      FROM latest_winners lw
      LEFT JOIN names n USING (item_slug)
      ORDER BY lw.won_at DESC
      `,
      [guildId]
    );

    if (!rows?.length) {
      return ctx.reply("📭 Keine Gewinner in den letzten 48 Stunden.", {
        ephemeral: true,
      });
    }

    // 2) Namen robust bestimmen: votes (48h) → items.json → slug
    const lines = rows.map((r) => {
      const fromVotes = r.item_name && String(r.item_name).trim();
      const fromItems = mapNameFromItemsJson(r.item_slug);
      const displayName = fromVotes || fromItems || r.item_slug;
      return `• **${displayName}** → <@${r.user_id}>`;
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
