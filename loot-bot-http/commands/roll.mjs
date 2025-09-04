// commands/roll.mjs
import { hasModPerm } from "../services/permissions.mjs";
import crypto from "node:crypto";

export default {
  name: "roll",
  description: "Loot-Roll für ein Item (Dropdown-Auswahl)",
  options: [],
  type: 1, // CHAT_INPUT
  dm_permission: false,
  default_member_permissions: null,

  run: async (ctx) => {
    try {
      // 1) Permissions
      if (!hasModPerm(ctx)) {
        return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
      }

      const guildId = ctx.guildId;

      // 2) Items mit Votes der letzten 48h laden
      const sql = `
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
      `;
      const items = await ctx.db.query(sql, [guildId]);

      if (!items?.length) {
        return ctx.reply("ℹ️ Keine qualifizierten Items in den letzten 48h.", { ephemeral: true });
      }

      // 3) Dropdown-Options
      const options = items.map((it) => ({
        label: (it.item_name || it.item_slug).slice(0, 100),
        value: it.item_slug,
        description: `${it.votes} Vote(s) · letzte 48h`,
      }));

      // 4) Component (custom_id mit Prefix für Router)
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

      // 5) Öffentlich antworten (Transparenz)
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
  },
};
