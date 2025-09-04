// commands/roll.mjs
// Zeigt IMMER ein Dropdown mit allen Items (48h) und triggert roll-select via custom_id.
// Permissions & DB-Zugriff: hasModPerm + ctx.db.query
// WICHTIG: robuste Guild-ID-Ermittlung (mehrere Fallbacks wie in euren anderen Commands)

import { hasModPerm } from "../services/permissions.mjs";
import crypto from "node:crypto";

function toLabel(s) {
  return String(s || "").slice(0, 100);
}

function getGuildId(ctx) {
  // tolerant: je nach Router kann es guildId, guild_id oder ctx.guild?.id sein
  return (
    ctx?.guildId ??
    ctx?.guild_id ??
    ctx?.interaction?.guild_id ??
    ctx?.guild?.id ??
    null
  );
}

export async function run(ctx) {
  try {
    // 1) Permissions
    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    // 2) Guild-ID robust ermitteln
    const guildId = getGuildId(ctx);
    if (!guildId) {
      return ctx.reply("⚠️ Konnte die Guild-ID nicht ermitteln.", { ephemeral: true });
    }

    // 3) Items mit Votes der letzten 48h laden
    // (gleiches Sichtfenster wie /vote-show; falls bei euch ein anderer Zeitraumname genutzt wird,
    // ist 'INTERVAL ''48 hours''' identisch zu 'INTERVAL ''2 days'''.)
    const sql = `
      SELECT
        v.item_slug,
        MIN(v.item_name_first) AS item_name,
        COUNT(*)::int AS votes
      FROM votes v
      WHERE v.guild_id = $1
        AND v.created_at > NOW() - INTERVAL '48 hours'
      GROUP BY v.item_slug
      HAVING COUNT(*) > 0
      ORDER BY votes DESC, item_slug ASC
      LIMIT 25
    `;
    const items = await ctx.db.query(sql, [String(guildId)]);

    if (!items?.length) {
      // Wenn /vote-show etwas anzeigt, wir hier aber nichts finden,
      // lag es bisher zu 99% an der Guild-ID. Mit den Fallbacks oben sollte es jetzt passen.
      return ctx.reply("ℹ️ Keine qualifizierten Items in den letzten 48h.", { ephemeral: true });
    }

    // 4) Dropdown-Options
    const options = items.map((it) => ({
      label: toLabel(it.item_name || it.item_slug),
      value: it.item_slug,
      description: `${it.votes} Vote(s) · letzte 48h`,
    }));

    // 5) Component (custom_id mit Prefix für Router → roll-select)
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

    // 6) Öffentlich antworten (Transparenz)
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
