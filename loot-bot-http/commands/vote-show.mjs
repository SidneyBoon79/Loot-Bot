// commands/vote-show.mjs — öffentlicher Überblick (48h), Timeout-safe via defer()
//
// Nutzt dein Schema:
// votes: (guild_id, item_slug, type, item_name_first, created_at, …)

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

  // Votes der letzten 48h je Item aggregieren
  const { rows } = await ctx.db.query(
    `SELECT
       v.item_slug,
       MAX(v.item_name_first) AS item_name_first,
       SUM(CASE WHEN v.type='gear'  THEN 1 ELSE 0 END) AS c_gear,
       SUM(CASE WHEN v.type='trait' THEN 1 ELSE 0 END) AS c_trait,
       SUM(CASE WHEN v.type='litho' THEN 1 ELSE 0 END) AS c_litho,
       COUNT(*) AS c_total,
       MIN(v.created_at) AS first_vote_at,
       MAX(v.created_at) AS last_vote_at
     FROM votes v
     WHERE v.guild_id = $1
       AND v.created_at >= NOW() - INTERVAL '48 hours'
     GROUP BY v.item_slug`,
    [ctx.guildId]
  );

  if (!rows.length) {
    return ctx.followUp("Keine gültigen Votes im 48h-Fenster. ✨", { ephemeral: false });
  }

  // Sortierung: stärkstes Top-Reason (⚔️>💠>📜) desc → total desc → Name asc
  const items = rows.map(r => {
    const counts = { gear: Number(r.c_gear)||0, trait: Number(r.c_trait)||0, litho: Number(r.c_litho)||0 };
    const top = (["gear","trait","litho"]).sort((a,b) => (counts[b]-counts[a]) || (WEIGHT[b]-WEIGHT[a]))[0];
    return {
      name: r.item_name_first,
      slug: r.item_slug,
      counts,
      total: Number(r.c_total)||0,
      top,
      first: new Date(r.first_vote_at),
      last:  new Date(r.last_vote_at)
    };
  }).sort((a,b) => {
    const w = WEIGHT[a.top] - WEIGHT[b.top];
    if (w !== 0) return -(w);
    if (a.total !== b.total) return b.total - a.total;
    return (a.name||"").localeCompare(b.name||"", "de");
  });

  const now = Date.now();
  const soonMs = 36 * 60 * 60 * 1000; // 🟡 wenn älter als 36h (läuft bald aus)
  const lines = items.map(it => {
    const ageMs = now - it.first.getTime();
    const flag = ageMs >= soonMs ? "🟡" : "✅";
    const detail =
      `${REASON_LABEL.get("gear")} ${fmtCount(it.counts.gear)} · ` +
      `${REASON_LABEL.get("trait")} ${fmtCount(it.counts.trait)} · ` +
      `${REASON_LABEL.get("litho")} ${fmtCount(it.counts.litho)}`;
    return `${flag} **${it.name}** — ${fmtCount(it.total)} Stimmen (${detail})`;
  });

  const header = `**Votes der letzten 48h (${fmtCount(items.length)} Items):**\n` +
                 `✅ frisch · 🟡 läuft bald aus`;
  const body = header + `\n\n` + lines.join("\n");

  return ctx.followUp(body, { ephemeral: false });
}
