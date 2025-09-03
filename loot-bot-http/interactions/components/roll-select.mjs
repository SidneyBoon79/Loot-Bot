// interactions/components/roll-select.mjs
// Handler für /roll -> Dropdown-Auswahl

export async function handleRollSelect(ctx) {
  try {
    const id =
      (typeof ctx.customId === "function" && ctx.customId()) ||
      ctx.interaction?.data?.custom_id ||
      "";

    if (id !== "roll:select") return;

    const values =
      (typeof ctx.values === "function" && ctx.values()) ||
      ctx.interaction?.data?.values ||
      [];
    const slug = Array.isArray(values) && values.length ? values[0] : null;
    if (!slug) {
      return ctx.update({
        content: "Kein Item gewählt.",
        components: []
      });
    }

    // Votes für dieses Item laden
    const res = await ctx.db.query(
      `SELECT v.user_id, v.type
         FROM votes v
        WHERE v.guild_id = $1 AND v.item_slug = $2
          AND v.created_at > NOW() - INTERVAL '48 hours'`,
      [ctx.guildId, slug]
    );

    if (res.rowCount === 0) {
      return ctx.update({
        content: "Keine gültigen Votes für dieses Item.",
        components: []
      });
    }

    // Ranking: Grund (⚔️ > 💠 > 📜) > Wins asc > Roll d100 desc
    const priority = { gear: 3, trait: 2, litho: 1 };
    const candidates = [];

    for (const row of res.rows) {
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
      [ctx.guildId, slug, ctx.userId]
    );

    // Gewinner-Wins +1
    await ctx.db.query(
      `INSERT INTO wins (guild_id, user_id, win_count, updated_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET win_count = wins.win_count + 1, updated_at = NOW()`,
      [ctx.guildId, winner.user_id]
    );

    // Ausgabe
    const lines = candidates.map((c, idx) => {
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "➖";
      return `${medal} <@${c.user_id}> — ${c.roll} (${c.reason}, Wins: ${c.wins})`;
    });

    return ctx.update({
      content: `🎲 Roll-Ergebnis für **${slug}**:\n\n${lines.join("\n")}\n\n🏆 Gewinner: <@${winner.user_id}>`,
      components: []
    });
  } catch (err) {
    console.error("[components/roll-select] error:", err);
    if (typeof ctx.update === "function") {
      return ctx.update({
        content: "Upps. Da ist was schiefgelaufen.",
        components: []
      });
    }
  }
}
