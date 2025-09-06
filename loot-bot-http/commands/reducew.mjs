// commands/reducew.mjs
// Wins reduzieren ausschließlich per Dropdown (je Klick -1). Nur für Mods.

import { hasModPerm } from "../services/permissions.mjs";

export const name = "reducew";
export const description = "Wins reduzieren (Dropdown)";

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
    type: 1, // Action Row
    components: [
      {
        type: 3, // String Select
        custom_id: "reducew-select",
        placeholder: "Wähle einen User (reduziert um 1)",
        min_values: 1,
        max_values: 1,
        options,
      },
    ],
  };
}

function getGuildId(ctx) {
  return (
    (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
    ctx.guild_id ??
    ctx.guild?.id ??
    null
  );
}

export async function run(ctx) {
  try {
    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    const db = ctx.db;
    if (!db) return ctx.reply("❌ DB nicht verfügbar.", { ephemeral: true });

    const guildId = getGuildId(ctx);
    if (!guildId) {
      return ctx.reply("❌ Keine Guild-ID ermittelbar.", { ephemeral: true });
    }

    const users = await fetchUsersWithWins(db, guildId);
    if (!users.length) {
      return ctx.reply("ℹ️ Es gibt aktuell keine User mit Wins > 0.", {
        ephemeral: true,
      });
    }

    return ctx.reply(
      {
        content:
          "🧮 **Wins reduzieren**\nWähle einen User — jeder Klick reduziert um **1** (niemals unter 0).",
        components: [buildSelect(users)],
        ephemeral: true,
      },
      { ephemeral: true }
    );
  } catch (e) {
    console.error("[reducew] error:", e);
    return ctx.reply("⚠️ Fehler bei /reducew.", { ephemeral: true });
  }
}

export default { name, description, run };
