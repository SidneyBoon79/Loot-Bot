// commands/winner.mjs
// Kompakte Übersicht der Gewinner (jeder darf ausführen)

export const command = {
  name: "winner",
  description: "Zeigt eine kompakte Übersicht der Gewinner (letzte 48h)"
};

export async function run(ctx) {
  const res = await ctx.db.query(
    `SELECT w.user_id,
            i.item_name_first
       FROM wins w
       JOIN items i
         ON i.guild_id = w.guild_id
        AND i.item_slug = (
          SELECT v.item_slug
            FROM votes v
           WHERE v.guild_id = w.guild_id
             AND v.user_id  = w.user_id
           ORDER BY v.created_at DESC
           LIMIT 1
        )
      WHERE w.guild_id = $1
        AND w.updated_at > NOW() - INTERVAL '48 hours'
      ORDER BY i.item_name_first ASC`,
    [ctx.guildId]
  );

  if (res.rowCount === 0) {
    return ctx.reply("Keine Gewinner in den letzten 48h.", { ephemeral: true });
  }

  const lines = res.rows.map(
    r => `• <@${r.user_id}> — ${r.item_name_first}`
  );

  return ctx.reply(`# 🏆 Gewinner\n${lines.join("\n")}`);
}
