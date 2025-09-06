// commands/vote-clear.mjs
// Setzt alles zurück: votes + winners + wins

export const name = "vote-clear";
export const description = "Alle Votes, Winners & Wins für diese Guild zurücksetzen";

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) {
      return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });
    }

    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;

    if (!guildId) {
      return ctx.reply("❌ Keine Guild-ID ermittelbar.", { ephemeral: true });
    }

    await db.query("BEGIN");
    await db.query("DELETE FROM votes   WHERE guild_id = $1", [guildId]);
    await db.query("DELETE FROM winners WHERE guild_id = $1", [guildId]);
    await db.query("DELETE FROM wins    WHERE guild_id = $1", [guildId]);
    await db.query("COMMIT");

    return ctx.reply("✅ Reset: Votes, Winners & Wins wurden gelöscht.", { ephemeral: true });
  } catch (e) {
    try { await ctx.db?.query("ROLLBACK"); } catch {}
    console.error("[vote-clear error]", e);
    return ctx.reply("⚠️ Fehler beim Zurücksetzen.", { ephemeral: true });
  }
}

export default { name, description, run };
