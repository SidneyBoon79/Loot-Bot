// interactions/components/vote-remove-select.mjs
// Entfernt die jüngste Stimme des Users für die gewählte (item_slug, reason)-Kombi (Zeitraum 48h).

export const id = "vote-remove-select";
// etwas breiter, damit der Router das Component sicher findet (falls sich der custom_id mal ändert)
export const idStartsWith = "vote-remove";

const norm = (s) => String(s ?? "").trim().toLowerCase();

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;

    const userId =
      ctx.user?.id ?? ctx.member?.user?.id ?? ctx.author?.id ?? null;

    const values = ctx?.values ?? ctx?.interaction?.data?.values ?? [];
    const selected = values?.[0] ?? "";

    if (!guildId || !userId || !selected.includes("|")) {
      return ctx.reply("⚠️ Ungültige Auswahl.", { ephemeral: true });
    }

    // Value-Format aus dem Command: "<item_slug>|<reason>"
    const [itemSlugRaw, reasonRaw] = selected.split("|");
    const itemSlug = norm(itemSlugRaw);
    const reason   = norm(reasonRaw);

    // Prüfen, ob überhaupt eine passende Stimme existiert (jüngste zuerst)
    const { rows } = await db.query(
      `
      SELECT id, item_name_first
      FROM votes
      WHERE guild_id = $1
        AND user_id  = $2
        AND item_slug = $3
        AND LOWER(reason) = $4
        AND created_at > NOW() - INTERVAL '48 hours'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [guildId, userId, itemSlug, reason]
    );

    if (!rows?.length) {
      return ctx.reply("ℹ️ Für diese Auswahl gibt es von dir keine Stimme (48 h).", {
        ephemeral: true,
      });
    }

    const voteId   = rows[0].id;
    const itemName = rows[0].item_name_first;

    // Jüngste Stimme löschen
    await db.query(`DELETE FROM votes WHERE id = $1`, [voteId]);

    return ctx.reply(`✅ Stimme entfernt: **${itemName}** · ${reason}`, {
      ephemeral: true,
    });
  } catch (e) {
    console.error("[components/vote-remove-select] error:", e);
    return ctx.reply("⚠️ Konnte die Stimme nicht entfernen.", { ephemeral: true });
  }
}

export default { id, idStartsWith, run };
