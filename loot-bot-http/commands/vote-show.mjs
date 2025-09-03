// commands/vote-show.mjs (FINAL v3)
// Zeigt die Votes der letzten 48h (nur Summen, keine User-Mentions):
// • Item — 3 (⚔️ 2, 💠 1)

const ICONS = { gear: "⚔️", trait: "💠", litho: "📜" };

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId = typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId;

    const q = `
      SELECT item_name_first AS name, item_slug, reason, COUNT(*)::int AS c
      FROM votes
      WHERE guild_id = $1
        AND created_at > NOW() - INTERVAL '48 hours'
      GROUP BY item_name_first, item_slug, reason
      ORDER BY item_name_first
    `;
    const { rows } = await db.query(q, [guildId]);

    if (!rows.length) {
      return ctx.reply("📭 Keine Votes in den letzten 48h.", { ephemeral: true });
    }

    // Gruppieren nach Item
    const byItem = new Map();
    for (const r of rows) {
      if (!byItem.has(r.item_slug)) {
        byItem.set(r.item_slug, { name: r.name, totals: { gear: 0, trait: 0, litho: 0 }, total: 0 });
      }
      const entry = byItem.get(r.item_slug);
      if (r.reason === "gear" || r.reason === "trait" || r.reason === "litho") {
        entry.totals[r.reason] += r.c;
        entry.total += r.c;
      }
    }

    // Sortiert: Total desc, dann Name asc
    const list = [...byItem.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const lines = list.map(({ name, totals, total }) => {
      const parts = [];
      if (totals.gear)  parts.push(`${ICONS.gear} ${totals.gear}`);
      if (totals.trait) parts.push(`${ICONS.trait} ${totals.trait}`);
      if (totals.litho) parts.push(`${ICONS.litho} ${totals.litho}`);
      const suffix = parts.length ? ` (${parts.join(", ")})` : "";
      return `• **${name}** — ${total}${suffix}`;
    });

    const content = `🗳️ **Votes (letzte 48h)**
${lines.join("
")}`;
    return ctx.reply(content, { ephemeral: true });
  } catch (e) {
    console.error("[commands/vote-show] error:", e);
    return ctx.reply("❌ Konnte Votes nicht anzeigen.", { ephemeral: true });
  }
}

export default { run };
