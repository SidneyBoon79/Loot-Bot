// commands/changew.mjs
// /changew <user> <amount>  — passt win_count (+/-), auch für User ohne bestehenden Eintrag.

export const name = "changew";
export const description = "Wins anpassen (−3…−1 / +1…+3) für einen User";

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;
    if (!guildId) {
      return ctx.reply("❌ Konnte die Guild-ID nicht ermitteln.", { ephemeral: true });
    }

    // --- Options lesen ---
    const userRaw = ctx.opts?.getString?.("user");
    const amount  = Number(ctx.opts?.getInteger?.("amount"));

    if (!userRaw || !Number.isFinite(amount) || amount === 0 || amount < -3 || amount > 3) {
      return ctx.reply("⚠️ Nutzung: /changew user:<ID|@Mention> amount:{-3,-2,-1,1,2,3}", { ephemeral: true });
    }

    // User-ID aus @Mention oder Rohstring extrahieren
    const userId = String(userRaw).replace(/\D/g, "");
    if (!userId) {
      return ctx.reply("⚠️ Ungültiger User. Bitte ID oder @Mention angeben.", { ephemeral: true });
    }

    // --- Upsert: win_count anpassen, niemals < 0 ---
    await db.query(
      `
      INSERT INTO wins (guild_id, user_id, win_count, updated_at)
      VALUES ($1, $2, GREATEST($3, 0), NOW())
      ON CONFLICT (guild_id, user_id)
      DO UPDATE SET
        win_count  = GREATEST(wins.win_count + $3, 0),
        updated_at = NOW()
      `,
      [guildId, userId, amount]
    );

    // Aktuellen Stand zurückgeben
    const { rows } = await db.query(
      `SELECT win_count FROM wins WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId]
    );
    const current = rows?.[0]?.win_count ?? 0;

    const sign = amount > 0 ? "+" : "";
    return ctx.reply(
      `⚖️ Wins für <@${userId}> geändert: **${sign}${amount}** → aktueller Stand: **W${current}**.`,
      { ephemeral: true }
    );
  } catch (e) {
    console.error("[commands/changew] error:", e);
    return ctx.reply("❌ Fehler bei /changew.", { ephemeral: true });
  }
}

export default { name, description, run };
