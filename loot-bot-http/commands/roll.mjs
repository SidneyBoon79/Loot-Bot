// commands/roll.mjs
// Zeigt nur Items mit Votes (48h), die in `winners` (48h) NICHT gewonnen wurden.
// Auswahl triggert components/roll-select.mjs

export const name = "roll";
export const description = "Roll – wähle ein Item";

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

    // Items mit Votes (48h), EXKLUSIVE bereits gewonnene Items (winners 48h)
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
      blocked AS (
        SELECT DISTINCT item_slug
        FROM winners
        WHERE guild_id = $1
          AND won_at   > NOW() - INTERVAL '48 hours'
      )
      SELECT v.item_slug, v.item_name, v.votes
      FROM voted v
      WHERE NOT EXISTS (
        SELECT 1 FROM blocked b WHERE b.item_slug = v.item_slug
      )
      ORDER BY v.votes DESC, v.item_name ASC
      LIMIT 25
      `,
      [guildId]
    );

    if (!rows?.length) {
      return ctx.reply("ℹ️ Es gibt aktuell keine Items zum Rollen (48h, noch nicht gewonnen).", {
        ephemeral: true,
      });
    }

    const options = rows.map((r) => ({
      label: `${r.item_name} · ${r.votes} Stimme${r.votes === 1 ? "" : "n"}`,
      value: String(r.item_slug),
    }));

    return ctx.reply({
      content: "🎲 **Roll – wähle ein Item:**",
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "roll-select",
              placeholder: "Item auswählen …",
              min_values: 1,
              max_values: 1,
              options,
            },
          ],
        },
      ],
      ephemeral: false,
    });
  } catch (e) {
    console.error("[commands/roll] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /roll.", { ephemeral: true });
  }
}

export default { name, description, run };
