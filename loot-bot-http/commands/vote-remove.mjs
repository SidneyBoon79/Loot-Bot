// commands/vote-remove.mjs — User entfernt seine eigene Stimme via Dropdown
// danach Cleanup: wenn keine Votes für das Item mehr existieren und Item nicht gerollt → Item löschen

export async function run(ctx) {
  // Finde Items, für die der User in den letzten 48h gevotet hat
  const { rows } = await ctx.db.query(
    `SELECT v.item_slug, MAX(v.item_name_first) AS item_name_first, COUNT(*) AS c
       FROM votes v
      WHERE v.guild_id=$1 AND v.user_id=$2
        AND v.created_at >= NOW() - INTERVAL '48 hours'
      GROUP BY v.item_slug
      ORDER BY item_name_first ASC
      LIMIT 25`,
    [ctx.guildId, ctx.userId]
  );

  if (!rows.length) {
    return ctx.reply("Du hast in den letzten 48h keine Votes abgegeben.", { ephemeral: true });
  }

  const options = rows.map(r => ({
    label: r.item_name_first,
    value: r.item_slug,
    description: `${r.c} Stimme(n) von dir`
  }));

  const select = {
    type: 1,
    components: [
      { type: 3, custom_id: "vote-remove:select", placeholder: "Item auswählen …", min_values: 1, max_values: 1, options }
    ]
  };

  return ctx.reply({ content: "Wähle das Item, für das du deine Stimme entfernen willst:", components: [select] }, { ephemeral: true });
}

export async function handleSelect(ctx) {
  const slug = (ctx.itemSlug || "").trim();
  if (!slug) return ctx.followUp("Kein Item gewählt.", { ephemeral: true });

  // Lösche genau EINE Stimme dieses Users für das Item im 48h-Fenster (falls mehrere, nimm die jüngste)
  const del = await ctx.db.query(
    `DELETE FROM votes v
      WHERE v.ctid IN (
        SELECT ctid
          FROM votes
         WHERE guild_id=$1 AND user_id=$2 AND item_slug=$3
           AND created_at >= NOW() - INTERVAL '48 hours'
         ORDER BY created_at DESC
         LIMIT 1
      )`,
    [ctx.guildId, ctx.userId, slug]
  );

  // Name für Feedback
  const meta = await ctx.db.query(
    `SELECT MAX(item_name_first) AS name
       FROM votes
      WHERE guild_id=$1 AND item_slug=$2`,
    [ctx.guildId, slug]
  );
  const itemName = meta.rows[0]?.name || slug;

  if (del.rowCount === 0) {
    return ctx.followUp(`Keine entfernbare Stimme für **${itemName}** gefunden (48h-Fenster).`, { ephemeral: true });
  }

  // Cleanup: wenn keine Votes mehr für das Item existieren und nicht gerollt → Item löschen
  const leftVotes = await ctx.db.query(
    `SELECT COUNT(*)::int AS c FROM votes WHERE guild_id=$1 AND item_slug=$2`,
    [ctx.guildId, slug]
  );
  if ((leftVotes.rows[0]?.c ?? 0) === 0) {
    const itm = await ctx.db.query(
      `SELECT rolled_at, COALESCE(rolled_manual,false) AS rolled_manual
         FROM items
        WHERE guild_id=$1 AND item_slug=$2`,
      [ctx.guildId, slug]
    );
    const rolled = !!(itm.rows[0]?.rolled_at) || !!(itm.rows[0]?.rolled_manual);
    if (!rolled) {
      await ctx.db.query(
        `DELETE FROM items WHERE guild_id=$1 AND item_slug=$2`,
        [ctx.guildId, slug]
      );
    }
  }

  return ctx.followUp(`Deine Stimme für **${itemName}** wurde entfernt.`, { ephemeral: true });
}
