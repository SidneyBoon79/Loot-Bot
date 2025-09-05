// commands/vote-remove.mjs
// Zeigt dem aufrufenden User seine eigenen Stimmen (48h) und lässt eine entfernen.

export const name = "vote-remove";
export const description = "Entferne eine deiner Stimmen (48h)";

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;

    const userId =
      ctx.user?.id ?? ctx.member?.user?.id ?? ctx.author?.id ?? null;

    if (!guildId || !userId) {
      return ctx.reply("❌ Konnte Guild- oder User-ID nicht ermitteln.", { ephemeral: true });
    }

    // Eigene Stimmen der letzten 48h zusammentragen
    const { rows } = await db.query(
      `
      SELECT
        item_slug,
        MIN(item_name_first) AS item_name,
        LOWER(reason)        AS reason,
        COUNT(*)::int        AS votes
      FROM votes
      WHERE guild_id   = $1
        AND user_id    = $2
        AND created_at > NOW() - INTERVAL '48 hours'
      GROUP BY item_slug, LOWER(reason)
      ORDER BY item_name ASC, reason ASC
      LIMIT 25
      `,
      [guildId, userId]
    );

    if (!rows?.length) {
      return ctx.reply("ℹ️ Du hast in den letzten 48 Stunden keine Stimmen gesetzt.", {
        ephemeral: true,
      });
    }

    const rIcon = (r) => r === "gear" ? "🗡️" : r === "trait" ? "💠" : r === "litho" ? "📜" : "❔";

    // Value encoden: item_slug|reason
    const options = rows.map(r => ({
      label: `${r.item_name} · ${rIcon(r.reason)} ${r.reason} · ${r.votes} Stimme${r.votes===1?"":"n"}`,
      value: `${r.item_slug}|${r.reason}`,
    }));

    return ctx.reply({
      content: "🗑️ **Stimme entfernen – wähle Item/Grund:**",
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "vote-remove-select",
              placeholder: "Item/Grund auswählen …",
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
    console.error("[commands/vote-remove] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /vote-remove.", { ephemeral: true });
  }
}

export default { name, description, run };
