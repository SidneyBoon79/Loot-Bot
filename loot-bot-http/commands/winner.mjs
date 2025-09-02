// commands/winner.mjs — Gewinnerliste der letzten 48h (alphabetisch)
// Zeigt nur: User — Item (ohne Ranking, ohne Wurfzahlen)

export async function run(ctx) {
  ctx.requireMod?.();
  await ctx.defer({ ephemeral: false });

  const { rows } = await ctx.db.query(
    `SELECT w.user_id,
            i.item_name_first AS item_name,
            w.updated_at
       FROM items i
       JOIN wins w
         ON w.guild_id = i.guild_id
        AND w.user_id  = i.rolled_by
      WHERE i.guild_id = $1
        AND i.rolled_at >= NOW() - INTERVAL '48 hours'
      ORDER BY w.user_id ASC, i.item_name_first ASC`,
    [ctx.guildId]
  );

  if (!rows.length) {
    return ctx.followUp("Keine Gewinner in den letzten 48h. ✨", { ephemeral: false });
  }

  // Baue Zeilen
  const lines = rows.map(r => {
    return `<@${r.user_id}>   —   ${r.item_name}`;
  });

  const body = `**Gewinner der letzten 48h:**\n` + lines.join("\n");

  return ctx.followUp(body, { ephemeral: false });
}
