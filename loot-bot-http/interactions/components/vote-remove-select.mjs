// interactions/components/vote-remove-select.mjs
// Entfernt die jüngste Stimme des Users für die gewählte (item_slug, reason)-Kombi innerhalb von 48h.

export const id = "vote-remove-select";
export const idStartsWith = "vote-remove-select";

const norm = (s) => String(s ?? "").trim().toLowerCase();

export async function run(ctx) {
  const db = ctx.db;
  try {
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;

    const userId =
      ctx.user?.id ?? ctx.member?.user?.id ?? ctx.author?.id ?? null;

    const raw = ctx?.values ?? ctx?.interaction?.data?.values ?? [];
    const selected = raw?.[0] ?? "";

    if (!guildId || !userId || !selected.includes("|")) {
      return ctx.reply("⚠️ Ungültige Auswahl.", { ephemeral: true });
    }

    const [itemSlugRaw, reasonRaw] = selected.split("|");
    const itemSlug = norm(itemSlugRaw);
    const reason   = norm(reasonRaw);

    // Prüfen, ob Stimme(n) existieren
    const { rows: have } = await db.query(
      `
      SELECT id, item_name_first
      FROM votes
      WHERE guild_id   = $1
        AND user_id    = $2
        AND item_slug  = $3
        AND LOWER(reason) = $4
        AND created_at > NOW() - INTERVAL '48 hours'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [guildId, userId, itemSlug, reason]
    );

    if (!have?.length) {
      return ctx.reply("ℹ️ Für diese Auswahl gibt es von dir keine Stimme (48 h).", { ephemeral: true });
    }

    const voteId   = have[0].id;
    const itemName = have[0].item_name_first;

    // Jüngste Stimme löschen
    await db.query(`DELETE FROM votes WHERE id = $1`, [voteId]);

    return ctx.reply(`✅ Stimme entfernt: **${itemName}** · ${reason}`, { ephemeral: true });
  } catch (e) {
    console.error("[components/vote-remove-select] error:", e);
    return ctx.reply("⚠️ Konnte die Stimme nicht entfernen.", { ephemeral: true });
  }
}

export default { id, idStartsWith, run };
