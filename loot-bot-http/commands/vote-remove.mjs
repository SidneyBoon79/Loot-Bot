
// commands/vote-remove.mjs
// /vote-remove – löscht den eigenen Vote für ein Item (kein Überschreiben, sauber entfernen)

function normalizeItem(raw) {
  return (raw ?? "").trim().slice(0, 120);
}

function indexByName(options = []) {
  const map = Object.create(null);
  for (const o of options) map[o.name] = o;
  return map;
}

export async function run(ctx) {
  const opt = indexByName(ctx.options);
  const itemRaw = opt.item?.value;

  if (!itemRaw) {
    return ctx.reply("Bitte gib ein **Item** an, z. B. `/vote-remove item:<Schwert>`.", { ephemeral: true });
  }
  const item = normalizeItem(itemRaw);
  if (!item) {
    return ctx.reply("Das Item darf nicht leer sein.", { ephemeral: true });
  }

  // Sicherstellen, dass die Tabellen existieren (idempotent & schnell)
  await ensureSchema(ctx.db);

  // Vote des aufrufenden Users für dieses Item löschen
  const del = await ctx.db.query(
    `DELETE FROM votes
      WHERE guild_id = $1 AND user_id = $2 AND item_name = $3`,
    [ctx.guildId, ctx.userId, item]
  );

  if (del.rowCount === 0) {
    return ctx.reply(`Du hattest keinen Vote für **${item}**.`, { ephemeral: true });
  }

  // Orphans aufräumen: wenn keine Votes mehr für das Item existieren und es nicht gerollt wurde → aus items entfernen
  const { rows } = await ctx.db.query(
    `
    SELECT
      (SELECT COUNT(*) FROM votes v WHERE v.guild_id = $1 AND v.item_name = $2)::int AS remaining,
      (SELECT rolled FROM items i WHERE i.guild_id = $1 AND i.item_name = $2) AS rolled
    `,
    [ctx.guildId, item]
  );

  const remaining = rows[0]?.remaining ?? 0;
  const rolled = rows[0]?.rolled ?? false;

  if (remaining === 0 && rolled === false) {
    await ctx.db.query(`DELETE FROM items WHERE guild_id = $1 AND item_name = $2`, [ctx.guildId, item]);
  }

  return ctx.reply(`✅ Dein Vote für **${item}** wurde entfernt.`, { ephemeral: true });
}

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      reason     TEXT NOT NULL CHECK (reason IN ('gear','trait','litho')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, user_id, item_name)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS items (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      rolled     BOOLEAN NOT NULL DEFAULT FALSE,
      winner_id  TEXT,
      rolled_by  TEXT,
      rolled_at  TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, item_name)
    );
  `);
}
