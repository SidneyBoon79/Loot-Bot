// commands/reducew.mjs
// Reduziert die Win-Zahl eines Users (nur für Mods/Admins)

export const command = {
  name: "reducew",
  description: "Reduziert die Win-Zahl eines Users",
  options: [
    {
      type: 6, // USER
      name: "user",
      description: "Wähle den User aus",
      required: true
    },
    {
      type: 4, // INTEGER
      name: "anzahl",
      description: "Um wie viele Wins reduzieren?",
      required: true,
      min_value: 1
    }
  ]
};

export async function run(ctx) {
  // Berechtigung prüfen
  if (!ctx.member?.permissions?.includes("MANAGE_GUILD")) {
    return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
  }

  const user = ctx.opts.getUser("user");
  const amount = ctx.opts.getInteger("anzahl");

  if (!user || !amount) {
    return ctx.reply("Bitte User und Anzahl angeben.", { ephemeral: true });
  }

  // Update in DB
  const res = await ctx.db.query(
    `UPDATE wins
        SET win_count = GREATEST(win_count - $3, 0),
            updated_at = NOW()
      WHERE guild_id = $1 AND user_id = $2
      RETURNING win_count`,
    [ctx.guildId, user.id, amount]
  );

  if (res.rowCount === 0) {
    return ctx.reply(`Keine Wins für <@${user.id}> gefunden.`, {
      ephemeral: true
    });
  }

  const newCount = res.rows[0].win_count;

  return ctx.reply(
    `✅ Wins für <@${user.id}> um ${amount} reduziert.\nNeuer Stand: ${newCount}`,
    { ephemeral: true }
  );
}
