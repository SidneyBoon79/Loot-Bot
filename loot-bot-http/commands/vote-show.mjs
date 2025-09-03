// commands/vote-show.mjs (FINAL v4)
// Zeigt die Votes der letzten 48h (nur Summen, keine User-Mentions)

const ICONS = { gear: "⚔️", trait: "💠", litho: "📜" };

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId = typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId;

    const q = (
      "SELECT item_name_first AS name, item_slug, reason, COUNT(*)::int AS c " +
      "FROM votes " +
      "WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '48 hours' " +
      "GROUP BY item_name_first, item_slug, reason " +
      "ORDER BY item_name_first"
    );
    const { rows } = await db.query(q, [guildId]);

    if (!rows.length) {
      return ctx.reply("📭 Keine Votes in den letzten 48h.", { ephemeral: true });
    }

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

    const list = Array.from(byItem.values()).sort(function(a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name);
    });

    const lines = list.map(function (row) {
      const parts = [];
      if (row.totals.gear)  parts.push(ICONS.gear + " " + row.totals.gear);
      if (row.totals.trait) parts.push(ICONS.trait + " " + row.totals.trait);
      if (row.totals.litho) parts.push(ICONS.litho + " " + row.totals.litho);
      const suffix = parts.length ? " (" + parts.join(", ") + ")" : "";
      return "• **" + row.name + "** — " + row.total + suffix;
    });

    const header = "🗳️ **Votes (letzte 48h)**
";
    const body = lines.join("
");
    return ctx.reply(header + body, { ephemeral: true });
  } catch (e) {
    console.error("[commands/vote-show] error:", e);
    return ctx.reply("❌ Konnte Votes nicht anzeigen.", { ephemeral: true });
  }
}

export default { run };
