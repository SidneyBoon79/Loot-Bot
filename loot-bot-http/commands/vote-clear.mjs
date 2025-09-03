// commands/vote-clear.mjs
// Löscht Votes, Items und Wins komplett (Reset, nur für Mods/Admins)

export const command = {
  name: "vote-clear",
  description: "Löscht alle Votes, Items und Wins (Reset)"
};

export async function run(ctx) {
  // Nur für Admins/Mods gedacht → hier simple Abfrage, ggf. erweitern
  if (!ctx.member?.permissions?.includes("MANAGE_GUILD")) {
    return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
  }

  await ctx.db.query("DELETE FROM votes WHERE guild_id=$1", [ctx.guildId]);
  await ctx.db.query("DELETE FROM items WHERE guild_id=$1", [ctx.guildId]);
  await ctx.db.query("DELETE FROM wins WHERE guild_id=$1", [ctx.guildId]);

  return ctx.reply("✅ Alle Votes, Items und Wins wurden zurückgesetzt.", {
    ephemeral: true
  });
}
