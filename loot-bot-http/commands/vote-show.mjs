// commands/vote-show.mjs (FINAL v2)
// Zeigt die Votes der letzten 48 Stunden in dieser Guild – hübsch formatiert:
// • Item — ⚔️ @User1, @User2  💠 @User3  📜 @User4

const ICONS = { gear: "⚔️", trait: "💠", litho: "📜" };

function fmtMentions(userIds) {
  return userIds.map(id => `<@${id}>`).join(", ");
}

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId = typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId;

    // Rohdaten: pro Vote 1 Zeile (für hübsche Ausgabe brauchen wir die User-IDs)
    const q = `
      SELECT item_name_first AS name, item_slug, reason, user_id
      FROM votes
      WHERE guild_id = $1
        AND created_at > NOW() - INTERVAL '48 hours'
      ORDER BY item_name_first, created_at
    `;
    const { rows } = await db.query(q, [guildId]);

    if (!rows.length) {
      return ctx.reply("📭 Keine Votes in den letzten 48h.", { ephemeral: true });
    }

    // Gruppieren: Item -> reason -> Set(user_id)
    const byItem = new Map();
    for (const r of rows) {
      const key = r.item_slug;
      if (!byItem.has(key)) {
        byItem.set(key, { name: r.name, reasons: { gear: new Set(), trait: new Set(), litho: new Set() } });
      }
      const entry = byItem.get(key);
      if (entry.reasons[r.reason]) entry.reasons[r.reason].add(r.user_id);
    }

    // Sortieren nach Anzahl Votes desc, dann Name asc
    const list = [...byItem.values()].map(x => ({
      name: x.name,
      totals: {
        gear: x.reasons.gear.size,
        trait: x.reasons.trait.size,
        litho: x.reasons.litho.size,
      },
      reasons: x.reasons,
      total: x.reasons.gear.size + x.reasons.trait.size + x.reasons.litho.size,
    })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const lines = list.map(({ name, reasons, totals }) => {
      const parts = [];
      if (totals.gear)  parts.push(`${ICONS.gear} ${fmtMentions([...reasons.gear])}`);
      if (totals.trait) parts.push(`${ICONS.trait} ${fmtMentions([...reasons.trait])}`);
      if (totals.litho) parts.push(`${ICONS.litho} ${fmtMentions([...reasons.litho])}`);
      return `• **${name}** — ${parts.join("  ")}`;
    });

    const content = `🗳️ **Votes (letzte 48h)**
` + lines.join("
");
    return ctx.reply(content, { ephemeral: true });
  } catch (e) {
    console.error("[commands/vote-show] error:", e);
    return ctx.reply("❌ Konnte Votes nicht anzeigen.", { ephemeral: true });
  }
}

export default { run };
