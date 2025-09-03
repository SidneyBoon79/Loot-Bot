// commands/vote-show.mjs (FINAL)
// Zeigt die Votes der letzten 48 Stunden in dieser Guild, gruppiert nach Item.

function formatBlock(items) {
  if (!items.length) return "Kein Eintrag.";
  return items
    .map(({ name, total, reasons }) => {
      const parts = [];
      if (reasons.gear) parts.push(`⚔️ ${reasons.gear}`);
      if (reasons.trait) parts.push(`💠 ${reasons.trait}`);
      if (reasons.litho) parts.push(`📜 ${reasons.litho}`);
      const byReason = parts.length ? ` (" + parts.join(", ") + ")` : "";
      return `• **${name}** — ${total}${byReason}`;
    })
    .join("\n");
}

export async function run(ctx) {
  try {
    if (!ctx.db) {
      return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });
    }

    const guildId = typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId;

    const q = `
      SELECT item_name_first AS name, item_slug, reason, COUNT(*)::int AS c
      FROM votes
      WHERE guild_id = $1
        AND created_at > NOW() - INTERVAL '48 hours'
      GROUP BY item_name_first, item_slug, reason
      ORDER BY c DESC, item_name_first
    `;

    const { rows } = await ctx.db.query(q, [guildId]);

    // Gruppieren nach Item
    const byItem = new Map();
    for (const r of rows) {
      if (!byItem.has(r.item_slug)) {
        byItem.set(r.item_slug, { name: r.name, total: 0, reasons: { gear: 0, trait: 0, litho: 0 } });
      }
      const entry = byItem.get(r.item_slug);
      entry.total += r.c;
      if (r.reason === "gear" || r.reason === "trait" || r.reason === "litho") {
        entry.reasons[r.reason] += r.c;
      }
    }

    // Sortiert nach Total desc, dann Name asc
    const list = [...byItem.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const content = list.length
      ? `📊 **Votes (letzte 48h)**\n` + formatBlock(list)
      : "📭 Keine Votes in den letzten 48h.";

    return ctx.reply(content, { ephemeral: true });
  } catch (e) {
    console.error("[commands/vote-show] error:", e);
    return ctx.reply("❌ Konnte Votes nicht anzeigen.", { ephemeral: true });
  }
}

export default { run };
