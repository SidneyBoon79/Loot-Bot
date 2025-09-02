// commands/reducew.mjs
// /reducew – reduziert die Wins eines Users um <anzahl> (Mods only, nie unter 0)

function indexByName(options = []) {
  const map = Object.create(null);
  for (const o of options) map[o.name] = o;
  return map;
}

export async function run(ctx) {
  ctx.requireMod?.();

  const opt = indexByName(ctx.options);
  const user = opt.user?.value;      // Discord User-ID
  const amount = Number(opt.anzahl?.value ?? 0);

  if (!user) {
    return ctx.reply("Bitte einen **User** auswählen.", { ephemeral: true });
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return ctx.reply("Bitte eine **Anzahl ≥ 1** angeben.", { ephemeral: true });
  }

  await ensureSchema(ctx.db);

  // Upsert + Decrement, nie unter 0
  const q = `
    INSERT INTO wins (guild_id, user_id, win_count, updated_at)
    VALUES ($1, $2, 0, NOW())
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
      win_count = GREATEST(wins.win_count - $3, 0),
      updated_at = NOW()
    RETURNING win_count
  `;
  const params = [ctx.guildId, user, amount];

  try {
    const { rows } = await ctx.db.query(q, params);
    const newCount = rows[0]?.win_count ?? 0;

    // Ephemer für Mod, klar und knapp
    return ctx.reply(
      `Wins von <@${user}> um **${amount}** reduziert. Neuer Stand: **${newCount}W**.`,
      { ephemeral: true }
    );
  } catch (err) {
    console.error("/reducew error:", err);
    return ctx.reply("❌ Konnte die Wins nicht anpassen. Versuch’s später nochmal.", { ephemeral: true });
  }
}

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS wins (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      win_count  INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
  `);
}

