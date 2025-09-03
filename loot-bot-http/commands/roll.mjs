// commands/roll.mjs
// Roll für ein einzelnes Item (nur Mods/Admins)

export const command = {
  name: "roll",
  description: "Rollt ein einzelnes Item aus (nur für Mods/Admins)"
};

export async function run(ctx) {
  if (!ctx.member?.permissions?.includes("MANAGE_GUILD")) {
    return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
  }

  // Items sammeln, die Votes haben & nicht gerollt sind
  const res = await ctx.db.query(
    `SELECT i.item_slug, i.item_name_first,
            array_agg(json_build_object(
              'user_id', v.user_id,
              'type', v.type
            )) AS votes
       FROM items i
       JOIN votes v
         ON i.guild_id = v.guild_id
        AND i.item_slug = v.item_slug
      WHERE i.guild_id = $1
        AND i.rolled_at IS NULL
      GROUP BY i.item_slug, i.item_name_first
      ORDER BY i.item_name_first ASC`,
    [ctx.guildId]
  );

  if (res.rowCount === 0) {
    return ctx.reply("Keine offenen Items zum Rollen.", { ephemeral: true });
  }

  // Dropdown für Item-Auswahl bauen
  const options = res.rows.map(r => ({
    label: r.item_name_first,
    value: r.item_slug
  }));

  return ctx.reply({
    content: "Wähle ein Item zum Rollen:",
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "roll:select",
            placeholder: "Item auswählen…",
            min_values: 1,
            max_values: 1,
            options
          }
        ]
      }
    ],
    ephemeral: true
  });
}
