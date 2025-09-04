// commands/vote-show.mjs — FINAL v7 (Gear > Trait > Litho; innerhalb alphabetisch)

const ICONS = { gear: "⚔️", trait: "💠", litho: "📜" };

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId = typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId;

    const q =
      "SELECT item_name_first AS name, item_slug, reason, COUNT(*)::int AS c " +
      "FROM votes " +
      "WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '48 hours' " +
      "GROUP BY item_name_first, item_slug, reason " +
      "ORDER BY item_name_first";
    const { rows } = await db.query(q, [guildId]);

    if (!rows || rows.length === 0) {
      return ctx.reply("📭 Keine Votes in den letzten 48h.", { ephemeral: true });
    }

    const byItem = new Map();
    for (const r of rows) {
      let e = byItem.get(r.item_slug);
      if (!e) {
        e = { name: r.name, totals: { gear: 0, trait: 0, litho: 0 }, total: 0 };
        byItem.set(r.item_slug, e);
      }
      if (r.reason === "gear" || r.reason === "trait" || r.reason === "litho") {
        e.totals[r.reason] += r.c;
        e.total += r.c;
      }
    }

    const prioOf = (e) => (e.totals.gear ? 3 : e.totals.trait ? 2 : e.totals.litho ? 1 : 0);

    const list = Array.from(byItem.values()).sort((a, b) => {
      const pa = prioOf(a);
      const pb = prioOf(b);
      if (pb !== pa) return pb - pa;       // höherer Grund zuerst (Gear > Trait > Litho)
      return a.name.localeCompare(b.name); // innerhalb alphabetisch
    });

    const lines = list.map((row) => {
      const parts = [];
      if (row.totals.gear)  parts.push(`${ICONS.gear} ${row.totals.gear}`);
      if (row.totals.trait) parts.push(`${ICONS.trait} ${row.totals.trait}`);
      if (row.totals.litho) parts.push(`${ICONS.litho} ${row.totals.litho}`);
      const suffix = parts.length ? ` (${parts.join(", ")})` : "";
      return `• ${row.name} — ${row.total}${suffix}`;
    });

    return ctx.reply(`🗳️ Votes (letzte 48h)\n${lines.join("\n")}`, { ephemeral: true });
  } catch (e) {
    console.error("[commands/vote-show] error:", e);
    return ctx.reply("❌ Konnte Votes nicht anzeigen.", { ephemeral: true });
  }
}

export default { run };
