
// commands/vote-show.mjs
// /vote-show – zeigt aktuelle Votes im 48h-Fenster
// Optional: item:<Name> → nur dieses Item
//
// Anzeige-Logik:
// - Zählt nur Votes der letzten 48 Stunden (created_at > now()-interval '48 hours')
// - Zeigt pro Item: Gear / Trait / Litho + Status (🟡 offen / ✅ gerollt)
// - Ohne Item-Filter: alphabetisch nach Itemname
//
// Hinweis: Standardmäßig NICHT ephemer (damit alle die Übersicht sehen).
// Wenn du es privat willst, setze unten bei ctx.reply({ ... }, {ephemeral:true}).

function normalizeItem(raw) {
  return (raw ?? "").trim().slice(0, 200);
}

function indexByName(options = []) {
  const map = Object.create(null);
  for (const o of options) map[o.name] = o;
  return map;
}

export async function run(ctx) {
  const opt = indexByName(ctx.options);
  const itemRaw = opt.item?.value;
  const itemFilter = itemRaw ? normalizeItem(itemRaw) : null;

  await ensureSchema(ctx.db);

  if (itemFilter) {
    // Einzelnes Item
    const q = `
      WITH windowed AS (
        SELECT *
          FROM votes
         WHERE guild_id = $1
           AND item_name = $2
           AND created_at > NOW() - INTERVAL '48 hours'
      )
      SELECT
        i.item_name,
        COALESCE(i.rolled, FALSE) AS rolled,
        (SELECT COUNT(*)::int FROM windowed WHERE reason='gear')  AS gear,
        (SELECT COUNT(*)::int FROM windowed WHERE reason='trait') AS trait,
        (SELECT COUNT(*)::int FROM windowed WHERE reason='litho') AS litho
      FROM items i
      WHERE i.guild_id = $1 AND i.item_name = $2
      LIMIT 1;
    `;
    const { rows } = await ctx.db.query(q, [ctx.guildId, itemFilter]);

    if (rows.length === 0) {
      // Falls Item in items nicht existiert, checken wir ob es wenigstens Votes gab
      const { rows: v } = await ctx.db.query(
        `SELECT COUNT(*)::int AS c
           FROM votes
          WHERE guild_id=$1 AND item_name=$2
            AND created_at > NOW() - INTERVAL '48 hours'`,
        [ctx.guildId, itemFilter]
      );
      if ((v[0]?.c ?? 0) === 0) {
        return ctx.reply(`**${itemFilter}** hat aktuell keine Votes im 48h-Fenster.`, { ephemeral: false });
      }
      // Es gab Votes, aber Item wurde evtl. entfernt – einfache Fallback-Ausgabe:
      const { rows: agg } = await ctx.db.query(
        `
        SELECT
          SUM(CASE WHEN reason='gear'  THEN 1 ELSE 0 END)::int  AS gear,
          SUM(CASE WHEN reason='trait' THEN 1 ELSE 0 END)::int  AS trait,
          SUM(CASE WHEN reason='litho' THEN 1 ELSE 0 END)::int  AS litho
        FROM votes
        WHERE guild_id=$1 AND item_name=$2
          AND created_at > NOW() - INTERVAL '48 hours'
        `,
        [ctx.guildId, itemFilter]
      );
      const a = agg[0] || { gear: 0, trait: 0, litho: 0 };
      return ctx.reply(
        `**${itemFilter}** (🟡)\n• Gear: **${a.gear}**\n• Trait: **${a.trait}**\n• Litho: **${a.litho}**`,
        { ephemeral: false }
      );
    }

    const r = rows[0];
    const flag = r.rolled ? "✅" : "🟡";
    const msg =
      `**${r.item_name}** ${flag}\n` +
      `• Gear: **${r.gear}**\n` +
      `• Trait: **${r.trait}**\n` +
      `• Litho: **${r.litho}**`;

    return ctx.reply(msg, { ephemeral: false });
  }

  // Übersicht aller Items
  const qAll = `
    WITH windowed AS (
      SELECT *
        FROM votes
       WHERE guild_id = $1
         AND created_at > NOW() - INTERVAL '48 hours'
    )
    SELECT
      i.item_name,
      COALESCE(i.rolled, FALSE) AS rolled,
      COALESCE(SUM(CASE WHEN w.reason='gear'  THEN 1 ELSE 0 END),0)::int  AS gear,
      COALESCE(SUM(CASE WHEN w.reason='trait' THEN 1 ELSE 0 END),0)::int  AS trait,
      COALESCE(SUM(CASE WHEN w.reason='litho' THEN 1 ELSE 0 END),0)::int  AS litho
    FROM items i
    LEFT JOIN windowed w
      ON w.guild_id = i.guild_id AND w.item_name = i.item_name
    WHERE i.guild_id = $1
    GROUP BY i.item_name, i.rolled
    ORDER BY i.item_name ASC;
  `;
  const { rows: items } = await ctx.db.query(qAll, [ctx.guildId]);

  if (items.length === 0) {
    return ctx.reply("Aktuell gibt’s keine Votes im 48h-Fenster.", { ephemeral: false });
  }

  const lines = items.map(r => {
    const flag = r.rolled ? "✅" : "🟡";
    return `**${r.item_name}** ${flag}\n• Gear: **${r.gear}**\n• Trait: **${r.trait}**\n• Litho: **${r.litho}**`;
  }).join("\n\n");

  return ctx.reply(lines, { ephemeral: false });
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
