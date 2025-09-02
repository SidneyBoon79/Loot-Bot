// commands/roll.mjs — manueller Roll (Dropdown), Gear/Trait/Litho ausgeschrieben + Emojis
// Wurf = echter W100 (1–100)
// Sortierung: Grund (⚔️>💠>📜) desc → Wins asc → Wurf desc
const REASON_WEIGHT = { gear: 3, trait: 2, litho: 1 };
const RLABEL = { gear: "⚔️ Gear", trait: "💠 Trait", litho: "📜 Litho" };

function fmt(n){ return new Intl.NumberFormat("de-DE").format(Number(n)||0); }
function w100(){ return Math.floor(Math.random() * 100) + 1; } // 1..100

export async function run(ctx) {
  ctx.requireMod?.();

  const passed = ctx.itemSlug || (ctx.options?.find(o => o.name === "item")?.value);
  const itemSlug = (passed || "").trim();
  if (!itemSlug) {
    const msg = "Kein Item ausgewählt.";
    return ctx.useFollowUp ? ctx.followUp(msg, { ephemeral: true }) : ctx.reply(msg, { ephemeral: true });
  }

  const meta = await ctx.db.query(
    `SELECT MAX(item_name_first) AS name_first
       FROM items
      WHERE guild_id=$1 AND item_slug=$2`,
    [ctx.guildId, itemSlug]
  );
  const itemName = meta.rows[0]?.name_first || itemSlug;

  const { rows: votes } = await ctx.db.query(
    `SELECT v.user_id, v.type,
            COALESCE(w.win_count,0) AS wins
       FROM votes v
       LEFT JOIN wins w
              ON w.guild_id = v.guild_id AND w.user_id = v.user_id
      WHERE v.guild_id=$1 AND v.item_slug=$2
        AND v.created_at >= NOW() - INTERVAL '48 hours'`,
    [ctx.guildId, itemSlug]
  );

  if (!votes.length) {
    const msg = `Für **${itemName}** gibt es keine gültigen Votes im 48h-Fenster.`;
    return ctx.useFollowUp ? ctx.followUp(msg, { ephemeral: true }) : ctx.reply(msg, { ephemeral: true });
  }

  // Ranking nach Regeln
  const ranked = votes.map(v => ({
    user_id: v.user_id,
    reason:  v.type,
    weight:  REASON_WEIGHT[v.type] || 0,
    wins:    Number(v.wins)||0,
    roll:    w100() // echter 1..100 Wurf
  }))
  .sort((a,b) => {
    if (a.weight !== b.weight) return b.weight - a.weight; // Grund
    if (a.wins   !== b.wins)   return a.wins   - b.wins;   // Wins asc
    return b.roll - a.roll;                                 // Wurf desc (höher gewinnt)
  });

  const winner = ranked[0];

  // DB-Updates
  await ctx.db.query(
    `INSERT INTO wins (guild_id, user_id, win_count, updated_at)
     VALUES ($1,$2,1,NOW())
     ON CONFLICT (guild_id,user_id)
     DO UPDATE SET win_count = wins.win_count + 1, updated_at = NOW()`,
    [ctx.guildId, winner.user_id]
  );

  await ctx.db.query(
    `UPDATE items
        SET rolled_at = NOW(),
            rolled_by = $3,
            rolled_manual = TRUE
      WHERE guild_id=$1 AND item_slug=$2`,
    [ctx.guildId, itemSlug, winner.user_id]
  );

  const w = await ctx.db.query(
    `SELECT win_count FROM wins WHERE guild_id=$1 AND user_id=$2`,
    [ctx.guildId, winner.user_id]
  );
  const newWins = w.rows[0]?.win_count ?? 1;

  // Ausgabe (öffentlich), Top 3 mit 🥇/🥈/🥉, danach nur "—"
  const lines = ranked.slice(0, 15).map((r, idx) => {
    const marker = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "—";
    const reason = RLABEL[r.reason] || r.reason;
    return `${marker} <@${r.user_id}> · ${reason} · (W${fmt(r.wins)}) · Wurf ${fmt(r.roll)}`;
  });

  const winReason = RLABEL[winner.reason] || winner.reason;
  const header = `**Roll-Ergebnis für ${itemName}:**`;
  const footer = `🏆 Gewinner: <@${winner.user_id}> — ${winReason} · Wurf ${fmt(winner.roll)} · (W${fmt(newWins)})`;

  const body = `${header}\n${lines.join("\n")}\n\n${footer}`;

  if (ctx.useFollowUp) return ctx.followUp(body, { ephemeral: false });
  return ctx.reply(body, { ephemeral: false });
}
