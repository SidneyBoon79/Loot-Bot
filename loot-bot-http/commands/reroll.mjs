// commands/reroll.mjs
// Zeigt Items, die in den letzten 48h bereits gewonnen wurden (winners),
// und aktuell (48h) noch Votes haben. Auswahl triggert reroll-select.

export const name = "reroll";
export const description = "Reroll – wähle ein bereits gerolltes Item";

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

    // Items, die in winners (48h) vorkommen UND aktuell Votes haben (48h)
    const { rows } = await db.query(
      `
      WITH voted AS (
        SELECT
          item_slug,
          MIN(item_name_first) AS item_name,
          COUNT(*)::int        AS votes
        FROM votes
        WHERE guild_id = $1
          AND created_at > NOW() - INTERVAL '48 hours'
        GROUP BY item_slug
      ),
      already_won AS (
        SELECT DISTINCT item_slug
        FROM winners
        WHERE guild_id = $1
          AND won_at   > NOW() - INTERVAL '48 hours'
      )
      SELECT v.item_slug, v.item_name, v.votes
      FROM voted v
      WHERE EXISTS (
        SELECT 1 FROM already_won w WHERE w.item_slug = v.item_slug
      )
      ORDER BY v.votes DESC, v.item_name ASC
      LIMIT 25
      `,
      [guildId]
    );

    if (!rows?.length) {
      return ctx.reply("ℹ️ Es gibt aktuell keine Items für **Reroll** (48h bereits gewonnen + aktive Votes).", {
        ephemeral: true,
      });
    }

    const options = rows.map((r) => ({
      label: `${r.item_name} · ${r.votes} Stimme${r.votes === 1 ? "" : "n"}`,
      value: String(r.item_slug),
    }));

    return ctx.reply({
      content: "🎲 **Reroll – wähle ein Item:**",
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "reroll-select",
              placeholder: "Item auswählen …",
              min_values: 1,
              max_values: 1,
              options,
            },
          ],
        },
      ],
      ephemeral: true,
    });
  } catch (e) {
    console.error("[commands/reroll] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /reroll.", { ephemeral: true });
  }
}

export default { name, description, run };
