// commands/vote-remove.mjs
// Entfernt den eigenen Vote von einem Item.

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const command = {
  name: "vote-remove",
  description: "Entferne deinen Vote für ein Item",
  options: [
    {
      type: 3, // STRING
      name: "item",
      description: "Name des Items",
      required: true
    }
  ]
};

export async function run(ctx) {
  const itemName = ctx.opts.getString("item")?.trim();
  if (!itemName) {
    return ctx.reply("Bitte gib den Itemnamen an.", { ephemeral: true });
  }

  const slug = slugify(itemName);

  // Lösche den Vote des Users
  const res = await ctx.db.query(
    `DELETE FROM votes
      WHERE guild_id=$1 AND user_id=$2 AND item_slug=$3
      RETURNING item_slug`,
    [ctx.guildId, ctx.userId, slug]
  );

  if (res.rowCount === 0) {
    return ctx.reply(`Kein Vote für **${itemName}** gefunden.`, {
      ephemeral: true
    });
  }

  // Orphan-Cleanup: Wenn Item keine Votes mehr hat und nicht gerollt ist → löschen
  await ctx.db.query(
    `DELETE FROM items i
      WHERE i.guild_id=$1 AND i.item_slug=$2
        AND NOT EXISTS (
          SELECT 1 FROM votes v WHERE v.guild_id=$1 AND v.item_slug=$2
        )
        AND i.rolled_at IS NULL`,
    [ctx.guildId, slug]
  );

  return ctx.reply(`✅ Dein Vote für **${itemName}** wurde entfernt.`, {
    ephemeral: true
  });
}
