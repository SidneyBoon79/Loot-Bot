// commands/roll.mjs
import { hasModPerm } from "../services/permissions.mjs";
import { query } from "../services/db.mjs"; // erwartet: query(sql, params) -> rows[]
import crypto from "node:crypto";

/**
 * /roll
 * - Zeigt IMMER ein Dropdown mit allen Items, die in den letzten 48h Votes haben.
 * - Die eigentliche Auslosung passiert in interactions/components/roll-select.mjs
 */
export default {
  name: "roll",
  description: "Loot-Roll für ein Item (Dropdown-Auswahl)",
  options: [],
  type: 1, // CHAT_INPUT
  dm_permission: false,
  default_member_permissions: null,

  run: async (ctx) => {
    // 1) Permissions
    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    const guildId = ctx.guildId;

    // 2) Items der letzten 48h mit mindestens 1 Vote sammeln
    const items = await query(
      `
      SELECT
        v.item_slug,
        MIN(v.item_name_first) AS item_name,
        COUNT(*)::int AS votes
      FROM votes v
      WHERE v.guild_id = $1
        AND v.created_at > NOW() - INTERVAL '48 hours'
      GROUP BY v.item_slug
      ORDER BY votes DESC, item_slug ASC
      LIMIT 25
      `,
      [guildId]
    );

    if (!items?.length) {
      return ctx.reply("ℹ️ Keine qualifizierten Items in den letzten 48h.", { ephemeral: true });
    }

    // 3) Dropdown bauen
    const customId = `roll:select:${crypto.randomUUID()}`; // unique für diese Interaktion

    const options = items.map((it) => ({
      label: it.item_name?.slice(0, 100) || it.item_slug.slice(0, 100),
      value: it.item_slug,
      description: `${it.votes} Vote(s) · letzte 48h`,
    }));

    return ctx.reply({
      content: "Wähle ein Item für den Roll:",
      components: [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 3, // STRING_SELECT
              custom_id: customId, // wird vom Router nach interactions/components/roll-select.mjs geroutet
              placeholder: "Item wählen…",
              min_values: 1,
              max_values: 1,
              options,
            },
          ],
        },
      ],
      ephemeral: false, // öffentlich für Transparenz
    });
  },
};
