// commands/roll.mjs — manueller Roll (Dropdown), Schema: item_slug/type/item_name_first
// Sortierung: Grund (⚔️>💠>📜) desc → Wins asc → Wurf(desc). Gewinnerzeile zeigt Grund + neuen Win-Count.
const REASON_WEIGHT = { gear: 3, trait: 2, litho: 1 };

function fmt(n){ return new Intl.NumberFormat("de-DE").format(Number(n)||0); }

export async function run(ctx) {
  ctx.requireMod?.();

  // itemSlug kommt vom Dropdown (server.mjs setzt ctx.itemSlug), sonst Option "item"
  const passed = ctx.itemSlug || (ctx.options?.find(o => o.name === "item")?.value);
  const itemSlug = (passed || "").trim();
  if (!itemSlug) return ctx.followUp?.("Kein Item ausgewählt.", { ephemeral: true }) || ctx.reply("Kein Item ausgewählt.", { ephemeral: true });

  // Name holen + Votes im 48h-Fenster ziehen
  const meta = await ctx.db.query(
    `SELECT MAX(item_name_first) AS name_first,
            BOOL_OR(rolled_at IS NOT NULL OR COALESCE(rolled_manual,false)) AS rolled
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
    return ctx.followUp?.(msg, { ephemeral: true }) || ctx.reply(msg, { ephemeral: true });
  }

  // Ranking nach Regeln
  const ranked = votes.map(v => ({
    user_id: v.user_id,
    reason:  v.type,
    weight:  REASON_WEIGHT[v.type] || 0,
    wins:    Number(v.wins)||0,
    roll:    Math.floor(Math.random()*1000000) // groß für stabile Ordnung
  }))
  .sort((a,b) => {
    if (a.weight !== b.weight) return b.weight - a.weight; // Grund
    if (a.wins   !== b.wins)   return a.wins   - b.wins;   // Wins asc
    return b.roll - a.roll;                                   // Wurf desc
  });

  const winner = ranked[0];

  // DB-Updates: Wins + Item markieren
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

  // neuen Win-Count lesen für Anzeige
  const w = await ctx.db.query(
    `SELECT win_count FROM wins WHERE guild_id=$1 AND user_id=$2`,
    [ctx.guildId, winner.user_id]
  );
  const newWins = w.rows[0]?.win_count ?? 1;

  // Ausgabe bauen (öffentlich)
  const lines = ranked.slice(0, 15).map((r, idx) => {
    const pos = idx+1;
    const marker = pos === 1 ? "🏆" : "—";
    const reason = r.reason === "gear" ? "⚔️ Gear" : r.reason === "trait" ? "💠 Trait" : "📜 Litho";
    return `${marker} <@${r.user_id}> · ${reason} · Wins ${fmt(r.wins)} · Wurf ${fmt(r.roll)}`;
  });

  const winReason = winner.reason === "gear" ? "⚔️ Gear" : winner.reason === "trait" ? "💠 Trait" : "📜 Litho";
  const header = `**Roll-Ergebnis für ${itemName}:**`;
  const footer = `Gewinner: <@${winner.user_id}> — ${winReason} · neuer Stand: ${fmt(newWins)} Wins`;

  const body = `${header}\n${lines.join("\n")}\n\n${footer}`;

  if (ctx.useFollowUp) {
    return ctx.followUp(body, { ephemeral: false });
  }
  return ctx.reply(body, { ephemeral: false });
}
