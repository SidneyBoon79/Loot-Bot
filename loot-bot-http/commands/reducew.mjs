// commands/reducew.mjs
// Reduziert die Win-Zahl eines Users (nur für Mods/Admins)

import { hasModPerm } from "../services/permissions.mjs";

export const name = "reducew";
export const description = "Reduziert die Win-Zahl eines Users";

export async function run(ctx) {
  try {
    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    const user = ctx.opts.getUser("user");
    const amount = ctx.opts.getInteger("anzahl");

    if (!user || !amount) {
      return ctx.reply("Bitte User und Anzahl angeben.", { ephemeral: true });
    }

    const { rows, rowCount } = await ctx.db.query(
      `
      UPDATE wins
         SET win_count = GREATEST(win_count - $3, 0),
             updated_at = NOW()
       WHERE guild_id = $1
         AND user_id  = $2
      RETURNING win_count
      `,
      [ctx.guildId, user.id, amount]
    );

    if (rowCount === 0) {
      return ctx.reply(`Keine Wins für <@${user.id}> gefunden.`, { ephemeral: true });
    }

    const newCount = rows[0].win_count;

    return ctx.reply(
      `✅ Wins für <@${user.id}> um ${amount} reduziert.\nNeuer Stand: ${newCount}`,
      { ephemeral: true }
    );
  } catch (e) {
    console.error("[reducew] error:", e);
    return ctx.reply("⚠️ Fehler beim Reduzieren der Wins.", { ephemeral: true });
  }
}

export default { name, description, run };
