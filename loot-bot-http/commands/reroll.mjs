// commands/reroll.mjs
// Re-Roll für bereits gerollte Items (nur Mods/Admins)
// Flow:
// 1) Dropdown zeigt nur Items, die bereits gerollt wurden (rolled_at != NULL)
//    und in den letzten 48h gültige Votes besitzen.
// 2) Nach Auswahl folgt eine Bestätigung (Ja/Nein) – Component-Handler erledigt das Re-Rollen.

export const command = {
  name: "reroll",
  description: "Re-Roll eines bereits gerollten Items (nur für Mods/Admins)"
};

export async function run(ctx) {
  if (!ctx.member?.permissions?.includes("MANAGE_GUILD")) {
    return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
  }

  // Bereits gerollte Items suchen, die noch im 48h-Fenster Votes haben
  const res = await ctx.db.query(
    `SELECT i.item_slug, i.item_name_first, i.rolled_at
       FROM items i
      WHERE i.guild_id = $1
        AND i.rolled_at IS NOT NULL
        AND EXISTS (
              SELECT 1 FROM votes v
               WHERE v.guild_id = i.guild_id
                 AND v.item_slug = i.item_slug
                 AND v.created_at > NOW() - INTERVAL '48 hours'
            )
      ORDER BY i.rolled_at DESC, i.item_name_first ASC`,
    [ctx.guildId]
  );

  if (res.rowCount === 0) {
    return ctx.reply("Keine gerollten Items im 48h-Fenster gefunden.", { ephemeral: true });
  }

  const options = res.rows.map(r => ({
    label: r.item_name_first,
    value: r.item_slug,
    description: `Gerollt: ${new Date(r.rolled_at).toISOString().replace('T',' ').slice(0,16)}`
  }));

  return ctx.reply({
    content: "Wähle ein **bereits gerolltes** Item für den Re-Roll:",
    components: [
      {
        type: 1,
        components: [
          {
            type: 3, // STRING_SELECT
            custom_id: "reroll:select",
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
