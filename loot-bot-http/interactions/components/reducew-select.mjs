// interactions/components/reducew-select.mjs
// Handler für das Dropdown aus /reducew: reduziert win_count um 1, refresht die Liste.

import { hasModPerm } from "../../services/permissions.mjs";

async function fetchUsersWithWins(db, guildId) {
  const { rows } = await db.query(
    `
    SELECT user_id, win_count
    FROM wins
    WHERE guild_id = $1
      AND win_count > 0
    ORDER BY updated_at DESC, win_count DESC
    LIMIT 25
    `,
    [guildId]
  );
  return rows || [];
}

function buildSelect(users) {
  const options = users.map((u) => ({
    label: `User ${u.user_id} — W${u.win_count}`,
    value: String(u.user_id),
    description: `Wins: ${u.win_count}`,
  }));

  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: "reducew-select",
        placeholder: "Wähle einen User (reduziert um 1)",
        min_values: 1,
        max_values: 1,
        options,
      },
    ],
  };
}

export const id = "reducew-select";
export const idStartsWith = "reducew-select";

export async function run(ctx) {
  try {
    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    const db = ctx.db;
    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;

    const values = ctx.interaction?.data?.values || [];
    const targetId = values?.[0];
    if (!db || !guildId || !targetId) {
      return ctx.reply("⚠️ Ungültige Auswahl.", { ephemeral: true });
    }

    // Reduktion um 1 (niemals < 0)
    const { rows, rowCount } = await db.query(
      `
      UPDATE wins
         SET win_count = GREATEST(win_count - 1, 0),
             updated_at = NOW()
       WHERE guild_id = $1
         AND user_id  = $2
      RETURNING win_count
      `,
      [guildId, targetId]
    );

    if (rowCount === 0) {
      return ctx.update({
        content: `⚠️ Für <@${targetId}> existiert kein Wins-Eintrag.`,
        components: [],
      });
    }

    const newCount = rows[0].win_count;

    // Liste aktualisieren
    const users = await fetchUsersWithWins(db, guildId);
    const components = users.length ? [buildSelect(users)] : [];

    return ctx.update({
      content: `✅ Reduziert: <@${targetId}> · neuer Stand **W${newCount}**.\n` +
        (users.length
          ? "Wähle weitere User zum Reduzieren:"
          : "Es sind keine User mit Wins > 0 mehr vorhanden."),
      components,
    });
  } catch (e) {
    console.error("[reducew-select] error:", e);
    return ctx.reply("⚠️ Fehler beim Reduzieren.", { ephemeral: true });
  }
}

export default { id, idStartsWith, run };
