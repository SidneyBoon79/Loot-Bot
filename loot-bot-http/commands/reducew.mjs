export async function run(ctx) {
  ctx.requireMod();

  // Nur Gewinner mit mindestens 1 Win holen
  const { rows } = await ctx.db.query(
    `SELECT user_id, win_count 
       FROM wins 
      WHERE guild_id = $1 AND win_count > 0
      ORDER BY win_count DESC`,
    [ctx.guildId]
  );

  if (!rows.length) {
    return ctx.reply("❌ Keine Gewinner mit Wins vorhanden.", { ephemeral: true });
  }

  const optionsArr = rows.map(r => ({
    label: `Wins: ${r.win_count}`,
    value: r.user_id,
    description: `User ID: ${r.user_id}`,
    // Discord zeigt IDs im Dropdown → wir rendern Name später beim Modal
  }));

  return ctx.reply({
    content: "Wähle den User, dessen Wins du reduzieren willst:",
    components: [ {
      type: 1,
      components: [ {
        type: 3,
        custom_id: "reducew:userpick",
        placeholder: "User auswählen …",
        min_values: 1,
        max_values: 1,
        options: optionsArr
      }]
    }]
  }, { ephemeral: true });
}
