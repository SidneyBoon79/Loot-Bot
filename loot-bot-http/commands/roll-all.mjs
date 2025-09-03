// commands/roll-all.mjs
// Rollt alle offenen Items in zufälliger Reihenfolge (nur Mods/Admins)

export const command = {
  name: "roll-all",
  description: "Rollt alle offenen Items in zufälliger Reihenfolge (nur Mods/Admins)"
};

export async function run(ctx) {
  if (!ctx.member?.permissions?.includes("MANAGE_GUILD")) {
    return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
  }

  // Alle ungerollten Items mit Votes laden
  const res = await ctx.db.query(
    `SELECT i.item_slug, i.item_name_first
       FROM items i
      WHERE i.guild_id = $1
        AND i.rolled_at IS NULL
        AND EXISTS (
          SELECT 1 FROM votes v
           WHERE v.guild_id = i.guild_id
             AND v.item_slug = i.item_slug
             AND v.created_at > NOW() - INTERVAL '48 hours'
        )`,
    [ctx.guildId]
  );

  if (res.rowCount === 0) {
    return ctx.reply("Keine offenen Items zum Rollen.", { ephemeral: true });
  }

  // Randomisierte Reihenfolge
  const items = res.rows.sort(() => Math.random() - 0.5);

  // Output für alle Rolls
  const results = [];

  for (const item of items) {
    // Votes holen
    const votesRes = await ctx.db.query(
      `SELECT v.user_id, v.type
         FROM votes v
        WHERE v.guild_id=$1 AND v.item_slug=$2
          AND v.created_at > NOW() - INTERVAL '48 hours'`,
      [ctx.guildId, item.item_slug]
    );

    if (votesRes.rowCount === 0) continue;

    // Ranking: Grund > Wins > Roll
    const priority = { gear: 3, trait: 2, litho: 1 };
    const candidates = [];

    for (const row of votesRes.rows) {
      const winRes = await ctx.db.query(
        `SELECT win_count FROM wins WHERE guild_id=$1 AND user_id=$2`,
        [ctx.guildId, row.user_id]
      );
      const wins = winRes.rowCount ? winRes.rows[0].win_count : 0;

      candidates.push({
        user_id: row.user_id,
        reason: row.type,
        priority: priority[row.type] || 0,
        wins,
        roll: Math.floor(Math.random() * 100) + 1
      });
    }

    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.wins !== b.wins) return a.wins - b.wins;
      return b.roll - a.roll;
    });

    const winner = candidates[0];

    // Item als gerollt markieren
    await ctx.db.query(
      `UPDATE items
          SET rolled_at = NOW(),
              rolled_by = $3
        WHERE guild_id=$1 AND item_slug=$2`,
      [ctx.guildId, item.item_slug, ctx.userId]
    );

    // Gewinner-Wins +1
    await ctx.db.query(
      `INSERT INTO wins (guild_id, user_id, win_count, updated_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET win_count = wins.win_count + 1, updated_at = NOW()`,
      [ctx.guildId, winner.user_id]
    );

    // Formatierte Ausgabe
    const lines = candidates.map((c, idx) => {
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "➖";
      return `${medal} <@${c.user_id}> — ${c.roll} (${c.reason}, Wins: ${c.wins})`;
    });

    results.push(
      `🎲 Roll-Ergebnis für **${item.item_name_first}**:\n${lines.join("\n")}\n🏆 Gewinner: <@${winner.user_id}>`
    );
  }

  if (results.length === 0) {
    return ctx.reply("Keine gültigen Votes gefunden.", { ephemeral: true });
  }

  // Öffentliche Ausgabe aller Ergebnisse
  return ctx.reply(results.join("\n\n"));
}
