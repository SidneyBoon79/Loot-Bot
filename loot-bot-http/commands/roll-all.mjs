// commands/roll-all.mjs — rollt alle Items mit gültigen Votes (48h) in einem Rutsch
// Style & Logik wie /roll: W100, 🥇/🥈/🥉, Gewinner unten mit 🏆 · Wurf NN · (Wn)

const REASON_WEIGHT = { gear: 3, trait: 2, litho: 1 };
const RLABEL        = { gear: "⚔️ Gear", trait: "💠 Trait", litho: "📜 Litho" };

function fmt(n){ return new Intl.NumberFormat("de-DE").format(Number(n)||0); }
function w100(){ return Math.floor(Math.random()*100) + 1; } // 1..100

function chunkStrings(str, max=1900) {
  // Discord ~2000 Zeichen Limit – wir bleiben konservativ
  const parts = [];
  let cur = "";
  for (const line of str.split("\n")) {
    if ((cur + line + "\n").length > max) {
      parts.push(cur);
      cur = "";
    }
    cur += line + "\n";
  }
  if (cur) parts.push(cur);
  return parts;
}

export async function run(ctx) {
  ctx.requireMod?.();

  // sofort ack (öffentlich)
  await ctx.defer({ ephemeral: false });

  // Alle rollbaren Items (Votes im 48h Fenster, noch nicht gerollt)
  const { rows: items } = await ctx.db.query(
    `SELECT i.item_slug,
            MAX(i.item_name_first) AS item_name_first,
            COUNT(v.*) FILTER (WHERE v.created_at >= NOW() - INTERVAL '48 hours') AS c_votes
       FROM items i
       JOIN votes v
         ON v.guild_id = i.guild_id
        AND v.item_slug = i.item_slug
        AND v.created_at >= NOW() - INTERVAL '48 hours'
      WHERE i.guild_id = $1
        AND (i.rolled_at IS NULL AND NOT COALESCE(i.rolled_manual,false))
      GROUP BY i.item_slug
      HAVING COUNT(v.*) > 0
      ORDER BY item_name_first ASC`,
    [ctx.guildId]
  );

  if (!items.length) {
    return ctx.followUp("Nichts zu tun: Keine **offenen Items** mit gültigen Votes (48h). ✅", { ephemeral: false });
  }

  // Zufällige Reihenfolge – damit es „fair“ wirkt
  const shuffled = items
    .map(x => ({ ...x, r: Math.random() }))
    .sort((a,b) => a.r - b.r);

  const outputs = [];

  for (const it of shuffled) {
    const slug = it.item_slug;
    const itemName = it.item_name_first || slug;

    // Votes für dieses Item ziehen
    const { rows: votes } = await ctx.db.query(
      `SELECT v.user_id, v.type,
              COALESCE(w.win_count,0) AS wins
         FROM votes v
         LEFT JOIN wins w
                ON w.guild_id = v.guild_id AND w.user_id = v.user_id
        WHERE v.guild_id=$1 AND v.item_slug=$2
          AND v.created_at >= NOW() - INTERVAL '48 hours'`,
      [ctx.guildId, slug]
    );

    if (!votes.length) {
      outputs.push(`**${itemName}:** — keine gültigen Votes (48h). Übersprungen.`);
      continue;
    }

    // Ranking nach Regeln: Grund (⚔️>💠>📜) desc → Wins asc → Wurf desc
    const ranked = votes.map(v => ({
      user_id: v.user_id,
      reason:  v.type,
      weight:  REASON_WEIGHT[v.type] || 0,
      wins:    Number(v.wins)||0,
      roll:    w100()
    }))
    .sort((a,b) => {
      if (a.weight !== b.weight) return b.weight - a.weight;
      if (a.wins   !== b.wins)   return a.wins   - b.wins;
      return b.roll - a.roll;
    });

    const winner = ranked[0];

    // DB-Updates: Wins & Item-Status
    await ctx.db.query(
      `INSERT INTO wins (guild_id, user_id, win_count, updated_at)
       VALUES ($1,$2,1,NOW())
       ON CONFLICT (guild_id,user_id)
       DO UPDATE SET win_count = wins.win_count + 1, updated_at = NOW()`,
      [ctx.guildId, winner.user_id]
    );

    await ctx.db.query(
      `UPDATE items
          SET rolled_at   = NOW(),
              rolled_by   = $3,
              rolled_manual = TRUE
        WHERE guild_id=$1 AND item_slug=$2`,
      [ctx.guildId, slug, winner.user_id]
    );

    const w = await ctx.db.query(
      `SELECT win_count FROM wins WHERE guild_id=$1 AND user_id=$2`,
      [ctx.guildId, winner.user_id]
    );
    const newWins = w.rows[0]?.win_count ?? 1;

    // Ausgabe für dieses Item (kompakt wie /roll)
    const lines = ranked.slice(0, 15).map((r, idx) => {
      const marker = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "—";
      const reason = RLABEL[r.reason] || r.reason;
      return `${marker} <@${r.user_id}> · ${reason} · (W${fmt(r.wins)}) · Wurf ${fmt(r.roll)}`;
    });

    const winReason = RLABEL[winner.reason] || winner.reason;
    const block =
      `**Roll-Ergebnis für ${itemName}:**\n` +
      `${lines.join("\n")}\n\n` +
      `🏆 Gewinner: <@${winner.user_id}> — ${winReason} · Wurf ${fmt(winner.roll)} · (W${fmt(newWins)})`;

    outputs.push(block);
  }

  // Alles posten (Chunking gegen 2k Limit)
  const text = outputs.join("\n\n");
  for (const part of chunkStrings(text)) {
    await ctx.followUp(part, { ephemeral: false });
  }
}
