// commands/vote-show.mjs — öffentlicher Überblick (48h), zeigt Roll-Status (🟢/🔴)
const REASON_LABEL = new Map([
  ["gear",  "⚔️ Gear"],
  ["trait", "💠 Trait"],
  ["litho", "📜 Litho"],
]);
const WEIGHT = { gear: 3, trait: 2, litho: 1 };
function fmtCount(n){ return new Intl.NumberFormat("de-DE").format(Number(n)||0); }

export async function run(ctx) {
  // sofort ack’n (kein Timeout), öffentlich
  await ctx.defer({ ephemeral: false });

  // Aggregation + Roll-Status aus items
  const { rows } = await ctx.db.query(
    `SELECT
       v.item_slug,
       MAX(v.item_name_first) AS item_name_first,
       SUM(CASE WHEN v.type='gear'  THEN 1 ELSE 0 END) AS c_gear,
       SUM(CASE WHEN v.type='trait' THEN 1 ELSE 0 END) AS c_trait,
       SUM(CASE WHEN v.type='litho' THEN 1 ELSE 0 END) AS c_litho,
       COUNT(*) AS c_total,
       BOOL_OR(i.rolled_at IS NOT NULL OR COALESCE(i.rolled_manual,false)) AS rolled
     FROM votes v
     LEFT JOIN items i
            ON i.guild_id = v.guild_id
           AND i.item_slug = v.item_slug
     WHERE v.guild_id = $1
       AND v.created_at >= NOW() - INTERVAL '48 hours'
     GROUP BY v.item_slug`,
    [ctx.guildId]
  );

  if (!rows.length) {
    return ctx.followUp("Keine gültigen Votes im 48h-Fenster. ✨", { ephemeral: false });
  }

  const items = rows.map(r => {
    const counts = { gear: Number(r.c_gear)||0, trait: Number(r.c_trait)||0, litho: Number(r.c_litho)||0 };
    const top = (["gear","trait","litho"]).sort((a,b) => (counts[b]-counts[a]) || (WEIGHT[b]-WEIGHT[a]))[0];
    return { name: r.item_name_first, slug: r.item_slug, counts, total: Number(r.c_total)||0, top, rolled: !!r.rolled };
  }).sort((a,b) => {
    const w = WEIGHT[a.top] - WEIGHT[b.top];
    if (w !== 0) return -(w);
    if (a.total !== b.total) return b.total - a.total;
    return (a.name||"").localeCompare(b.name||"", "de");
  });

  const lines = items.map(it => {
    const flag = it.rolled ? "🔴" : "🟢";
    const detail =
      `${REASON_LABEL.get("gear")} ${fmtCount(it.counts.gear)} · ` +
      `${REASON_LABEL.get("trait")} ${fmtCount(it.counts.trait)} · ` +
      `${REASON_LABEL.get("litho")} ${fmtCount(it.counts.litho)}`;
    return `${flag} **${it.name}** — ${fmtCount(it.total)} Stimmen (${detail})`;
  });

  const header = `**Votes der letzten 48h (${fmtCount(items.length)} Items):**\n` +
                 `🟢 nicht gerollt · 🔴 bereits gerollt`;
  return ctx.followUp(header + `\n\n` + lines.join("\n"), { ephemeral: false });
}
