// commands/vote-clear.mjs (FINAL)
// Löscht alle Votes und Items der aktuellen Guild.
// Nur für Nutzer mit Manage Guild ODER Administrator.

function hasPermBit(permStr, bitIndex) {
  try {
    if (!permStr) return false;
    const v = BigInt(permStr);
    return (v & (1n << BigInt(bitIndex))) !== 0n;
  } catch {
    return false;
  }
}

const PERMS = {
  ADMINISTRATOR: 3, // 0x00000008
  MANAGE_GUILD: 5,  // 0x00000020
};

export async function run(ctx) {
  try {
    const member = typeof ctx.member === "function" ? ctx.member() : ctx.member;
    const guildId = typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId;

    // --- Permission Check ---
    const permStr = member?.permissions; // Discord Bitfield als String
    const isAdmin = hasPermBit(permStr, PERMS.ADMINISTRATOR);
    const canManageGuild = hasPermBit(permStr, PERMS.MANAGE_GUILD);
    if (!isAdmin && !canManageGuild) {
      return ctx.reply("❌ Keine Berechtigung (benötigt: Administrator oder Manage Server).", { ephemeral: true });
    }

    if (!ctx.db) {
      return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });
    }

    // --- Cleanup innerhalb einer Transaktion ---
    const db = ctx.db;
    await db.query("BEGIN");
    try {
      // Votes der Guild löschen
      await db.query("DELETE FROM votes WHERE guild_id = $1", [guildId]);
      // Items der Guild löschen (nur Katalog-Einträge, Rollen-Historie damit clean)
      await db.query("DELETE FROM items WHERE guild_id = $1", [guildId]);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      console.error("[vote-clear] DB error:", e);
      return ctx.reply("❌ Konnte nicht leeren.", { ephemeral: true });
    }

    return ctx.reply("🧹 Alles sauber: Votes & Items dieser Guild wurden gelöscht.", { ephemeral: true });
  } catch (e) {
    console.error("[commands/vote-clear] error:", e);
    return ctx.reply("❌ Unerwarteter Fehler.", { ephemeral: true });
  }
}

export default { run };
