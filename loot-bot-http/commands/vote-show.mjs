// commands/vote-show.mjs
// Öffentliche Übersicht aller Items mit Votes der letzten 48h

export const command = {
  name: "vote-show",
  description: "Zeigt alle Votes der letzten 48h"
};

export async function run(ctx) {
  // Items + Votes der letzten 48h laden
  const res = await ctx.db.query(
    `SELECT i.item_name_first,
            i.item_slug,
            i.rolled_at,
            array_agg(json_build_object(
              'user_id', v.user_id,
              'type', v.type
            )) AS votes
       FROM items i
       JOIN votes v
         ON i.guild_id = v.guild_id
        AND i.item_slug = v.item_slug
      WHERE i.guild_id = $1
        AND v.created_at > NOW() - INTERVAL '48 hours'
      GROUP BY i.item_name_first, i.item_slug, i.rolled_at
      ORDER BY i.item_name_first ASC`,
    [ctx.guildId]
  );

  if (res.rowCount === 0) {
    return ctx.reply("Keine Votes in den letzten 48h.", { ephemeral: true });
  }

  // Formatierung
  const lines = [];
  for (const row of res.rows) {
    const status = row.rolled_at ? "🔴" : "🟢";
    const voters = (row.votes || [])
      .map(v => {
        const emoji =
          v.type === "gear" ? "⚔️" :
          v.type === "trait" ? "💠" :
          v.type === "litho" ? "📜" : "❔";
        return `${emoji} <@${v.user_id}>`;
      })
      .join(", ");

    lines.push(`${status} **${row.item_name_first}** — ${voters}`);
  }

  return ctx.reply(lines.join("\n"));
}
