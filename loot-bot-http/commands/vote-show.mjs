// commands/vote-show.mjs — FINAL v8 (mit 🔴/🟢 Hinweis)

const ICONS = { gear: "⚔️", trait: "💠", litho: "📜" };

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId = typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId;

    // Votes + Check ob in winners (48h) schon gerollt
    const q = `
      WITH voted AS (
        SELECT item_name_first AS name, item_slug, reason, COUNT(*)::int AS c
        FROM votes
        WHERE guild_id = $1
          AND created_at > NOW() - INTERVAL '48 hours'
        GROUP BY item_name_first, item_slug, reason
      ),
      rolled AS (
        SELECT DISTINCT item_slug
        FROM winners
        WHERE guild_id = $1
          AND won_at > NOW() - INTERVAL '48 hours'
      )
      SELECT v.name, v.item_slug, v.reason, v.c,
             CASE WHEN r.item_slug IS NULL THEN false ELSE true END AS already_rolled
      FROM voted v
      LEFT JOIN rolled r USING (item_slug)
      ORDER BY v.name
    `;
    const { rows } = await db.query(q, [guildId]);

    if (!rows || rows.length === 0) {
      return ctx.reply("📭 Keine Votes in den letzten 48h.", { ephemeral: true });
    }

    // Aggregation je Item
    const byItem = new Map();
    for (const r of rows) {
      let e = byItem.get(r.item_slug);
      if (!e) {
        e = { name: r.name, totals: { gear: 0, trait: 0, litho: 0 }, total: 0, rolled: r.already_rolled };
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
      if (pb !== pa) return pb - pa;
      return a.name.localeCompare(b.name);
    });

    const lines = list.map((row) => {
      const parts = [];
      if (row.totals.gear)  parts.push(`${ICONS.gear} ${row.totals.gear}`);
      if (row.totals.trait) parts.push(`${ICONS.trait} ${row.totals.trait}`);
      if (row.totals.litho) parts.push(`${ICONS.litho} ${row.totals.litho}`);
      const suffix = parts.length ? ` (${parts.join(", ")})` : "";
      const dot = row.rolled ? "🔴" : "🟢";
      return `${dot} ${row.name} — ${row.total}${suffix}`;
    });

    return ctx.reply(`🗳️ Votes (letzte 48h)\n${lines.join("\n")}`, { ephemeral: false });
  } catch (e) {
    console.error("[commands/vote-show] error:", e);
    return ctx.reply("❌ Konnte Votes nicht anzeigen.", { ephemeral: true });
  }
}

export default { run };
