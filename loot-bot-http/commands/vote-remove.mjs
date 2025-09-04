// commands/vote-remove.mjs — FINAL
// Zeigt dem Nutzer ein Dropdown mit den Items, die ER in den letzten 48h gevotet hat.
// Auswahl triggert den Component-Handler (custom_id: "vote:remove").

function b64u(s) {
  return Buffer.from(String(s), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function run(ctx) {
  try {
    if (!ctx.db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId = typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId;
    const userId  = typeof ctx.userId === "function" ? ctx.userId() : ctx.userId;

    const q = `
      SELECT item_name_first AS name, item_slug,
        SUM((reason='gear')::int)::int   AS gear,
        SUM((reason='trait')::int)::int  AS trait,
        SUM((reason='litho')::int)::int  AS litho,
        COUNT(*)::int                    AS total
      FROM votes
      WHERE guild_id = $1 AND user_id = $2
        AND created_at > NOW() - INTERVAL '48 hours'
      GROUP BY item_name_first, item_slug
      ORDER BY COUNT(*) DESC, item_name_first
      LIMIT 25
    `;

    const { rows } = await ctx.db.query(q, [guildId, userId]);
    if (!rows || rows.length === 0) {
      return ctx.reply("📭 Du hast in den letzten 48h keine Votes, die ich entfernen könnte.", { ephemeral: true });
    }

    // Dropdown-Optionen bauen
    const options = rows.map(r => {
      const parts = [];
      if (r.gear)  parts.push(`⚔️ ${r.gear}`);
      if (r.trait) parts.push(`💠 ${r.trait}`);
      if (r.litho) parts.push(`📜 ${r.litho}`);
      const suffix = parts.length ? ` (${parts.join(', ')})` : '';
      // value trägt JSON {slug,name} base64url-kodiert
      const value = b64u(JSON.stringify({ slug: r.item_slug, name: r.name }));
      return {
        label: `${r.name} — ${r.total}${suffix}`.slice(0, 100),
        value,
      };
    });

    const component = {
      type: 1, // ACTION_ROW
      components: [
        {
          type: 3, // STRING_SELECT
          custom_id: "vote:remove",
          min_values: 1,
          max_values: 1,
          placeholder: "Item wählen, dessen Vote du entfernen willst…",
          options,
        },
      ],
    };

    return ctx.reply({
      content: "🗑️ Wähle ein Item – ich entferne dann **deinen** Vote dazu (letzte 48h).",
      components: [component],
    }, { ephemeral: true });
  } catch (e) {
    console.error("[commands/vote-remove] error:", e);
    return ctx.reply("❌ Konnte deine Vote-Liste nicht laden.", { ephemeral: true });
  }
}

export default { run };
