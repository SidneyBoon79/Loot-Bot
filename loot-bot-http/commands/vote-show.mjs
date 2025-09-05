// commands/vote-show.mjs
// Zeigt die Items mit Stimmen (48h) und markiert pro Item:
// 🟢 = noch nicht gerollt (in winners 48h nicht vorhanden)
// 🔴 = bereits gerollt (in winners 48h vorhanden)

export const name = "vote-show";
export const description = "Zeige aktuelle Votes (48h)";

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

    // Votes der letzten 48h + Flag, ob schon gewonnen (winners) in 48h existiert
    const { rows } = await db.query(
      `
      WITH voted AS (
        SELECT
          item_slug,
          MIN(item_name_first) AS item_name,
          COUNT(*)::int        AS votes
        FROM votes
        WHERE guild_id   = $1
          AND created_at > NOW() - INTERVAL '48 hours'
        GROUP BY item_slug
      ),
      won AS (
        SELECT DISTINCT item_slug
        FROM winners
        WHERE guild_id = $1
          AND won_at   > NOW() - INTERVAL '48 hours'
      )
      SELECT
        v.item_slug,
        v.item_name,
        v.votes,
        CASE WHEN w.item_slug IS NULL THEN false ELSE true END AS already_rolled
      FROM voted v
      LEFT JOIN won w USING (item_slug)
      ORDER BY v.votes DESC, v.item_name ASC
      `,
      [guildId]
    );

    if (!rows?.length) {
      return ctx.reply("ℹ️ Keine Votes in den letzten 48 Stunden.", { ephemeral: false });
    }

    // Zeilen formatieren: 🔴/🟢 + Name + Stimmen
    const lines = rows.map(r => {
      const dot = r.already_rolled ? "🔴" : "🟢";
      const label = `${r.item_name} · ${r.votes} Stimme${r.votes === 1 ? "" : "n"}`;
      return `• ${dot} ${label}`;
    });

    const header = "🧾 Votes (letzte 48h)";
    return ctx.reply(`${header}\n${lines.join("\n")}`, { ephemeral: false });
  } catch (e) {
    console.error("[commands/vote-show] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /vote-show.", { ephemeral: true });
  }
}

export default { name, description, run };
