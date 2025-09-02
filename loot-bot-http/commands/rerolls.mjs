// commands/reroll.mjs — Re-Roll bereits gerollter Items mit Bestätigungs-Buttons
const REASON_WEIGHT = { gear: 3, trait: 2, litho: 1 };
const RLABEL = { gear: "⚔️ Gear", trait: "💠 Trait", litho: "📜 Litho" };

function fmt(n){ return new Intl.NumberFormat("de-DE").format(Number(n)||0); }
function w100(){ return Math.floor(Math.random() * 100) + 1; } // 1..100
function b64url(s){ return Buffer.from(s, "utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function ub64url(s){ return Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/")+"===", "base64").toString("utf8"); }

export async function run(ctx) {
  ctx.requireMod?.();

  // Dropdown: bereits gerollte Items mit gültigen Votes (48h)
  const { rows: items } = await ctx.db.query(
    `SELECT i.item_slug,
            MAX(i.item_name_first) AS item_name_first,
            COUNT(v.*) FILTER (WHERE v.created_at >= NOW() - INTERVAL '48 hours') AS c_votes
       FROM items i
       LEFT JOIN votes v
              ON v.guild_id = i.guild_id
             AND v.item_slug = i.item_slug
      WHERE i.guild_id = $1
        AND (i.rolled_at IS NOT NULL OR COALESCE(i.rolled_manual,false))
      GROUP BY i.item_slug
      HAVING COUNT(v.*) FILTER (WHERE v.created_at >= NOW() - INTERVAL '48 hours') > 0
      ORDER BY item_name_first ASC
      LIMIT 25`,
    [ctx.guildId]
  );

  if (!items.length) {
    return ctx.reply("Keine **gerollten Items** mit gültigen Votes (48h) gefunden. ✅", { ephemeral: true });
  }

  const optionsArr = items.map(r => ({
    label: `${r.item_name_first}`,
    value: r.item_slug,
    description: `🔴 bereits gerollt · ${r.c_votes} Votes`
  }));

  const select = {
    type: 1,
    components: [
      { type: 3, custom_id: "reroll:select", placeholder: "Item für Re-Roll auswählen …", min_values: 1, max_values: 1, options: optionsArr }
    ]
  };

  return ctx.reply({ content: "Wähle ein Item für den **Re-Roll**:", components: [select] }, { ephemeral: true });
}

export async function confirm(ctx, itemSlug) {
  // Name holen für Anzeige
  const meta = await ctx.db.query(
    `SELECT MAX(item_name_first) AS name_first FROM items WHERE guild_id=$1 AND item_slug=$2`,
    [ctx.guildId, itemSlug]
  );
  const name = meta.rows[0]?.name_first || itemSlug;

  const enc = b64url(itemSlug);
  const buttons = {
    type: 1,
    components: [
      { type: 2, style: 4, custom_id: `reroll:confirm_yes:${enc}`, label: "Ja, sicher!" },
      { type: 2, style: 2, custom_id: `reroll:confirm_no:${enc}`,  label: "Abbrechen" }
    ]
  };

  return ctx.reply({ content: `Bist du *wirklich* sicher, dass du **${name}** erneut rollen willst?`, components: [buttons] }, { ephemeral: true });
}

export async function execute(ctx, itemSlug) {
  // Votes (48h) holen
  const meta = await ctx.db.query(
    `SELECT MAX(item_name_first) AS name_first FROM items WHERE guild_id=$1 AND item_slug=$2`,
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
    return ctx.followUp(`Für **${itemName}** gibt es keine gültigen Votes im 48h-Fenster.`, { ephemeral: true });
  }

  const ranked = votes.map(v => ({
    user_id: v.user_id,
    reason:  v.type,
    weight:  REASON_WEIGHT[v.type] || 0,
    wins:    Number(v.wins)||0,
    roll:    w100()
  })).sort((a,b) => {
    if (a.weight !== b.weight) return b.weight - a.weight;
    if (a.wins   !== b.wins)   return a.wins   - b.wins;
    return b.roll - a.roll;
  });

  const winner = ranked[0];

  // Wins erhöhen & Item erneut markieren (Time + Winner)
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

  const lines = ranked.slice(0, 15).map((r, idx) => {
    const marker = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "—";
    const reason = RLABEL[r.reason] || r.reason;
    return `${marker} <@${r.user_id}> · ${reason} · (W${fmt(r.wins)}) · Wurf ${fmt(r.roll)}`;
  });

  const header = `**Re-Roll-Ergebnis für ${itemName}:**`;
  const footer = `🏆 Gewinner: <@${winner.user_id}> — ${RLABEL[winner.reason]} · Wurf ${fmt(winner.roll)} · (W${fmt(newWins)})`;
  const body = `${header}\n${lines.join("\n")}\n\n${footer}`;

  return ctx.followUp(body, { ephemeral: false });
}
