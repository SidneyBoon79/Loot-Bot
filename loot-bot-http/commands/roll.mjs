// commands/roll.mjs
// Zeigt IMMER ein Dropdown mit allen Items (48h) und triggert roll-select per custom_id.
// Gleiche Guild-ID/Query-Logik und DB-Aufrufschema wie vote-show.mjs (destructure { rows }).

import { hasModPerm } from "../services/permissions.mjs";
import crypto from "node:crypto";

function toLabel(s) {
  return String(s || "").slice(0, 100);
}

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    // exakt wie in vote-show.mjs
    const guildId = typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId;

    const q = `
      SELECT
        item_name_first AS name,
        item_slug,
        COUNT(*)::int AS c
      FROM votes
      WHERE guild_id = $1
        AND created_at > NOW() - INTERVAL '48 hours'
      GROUP BY item_name_first, item_slug
      ORDER BY name
      LIMIT 25
    `;
    const { rows } = await db.query(q, [guildId]);

    if (!rows || rows.length === 0) {
      return ctx.reply("ℹ️ Keine qualifizierten Items in den letzten 48h.", { ephemeral: true });
    }

    const options = rows.map(r => ({
      label: toLabel(r.name || r.item_slug),
      value: r.item_slug,
      description: `${r.c} Vote(s) · letzte 48h`,
    }));

    const customId = `roll:select:${crypto.randomUUID()}`;
    const row = {
      type: 1, // ACTION_ROW
      components: [
        {
          type: 3, // STRING_SELECT
          custom_id: customId,
          placeholder: "Item wählen…",
          min_values: 1,
          max_values: 1,
          options,
        },
      ],
    };

    return ctx.reply(
      {
        content: "Wähle ein Item für den Roll:",
        components: [row],
      },
      { ephemeral: false }
    );
  } catch (e) {
    console.error("[commands/roll] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /roll.", { ephemeral: true });
  }
}

export default { run };
