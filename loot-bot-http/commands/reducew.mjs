// commands/reducew.mjs
// Wins reduzieren – unterstützt zwei Wege:
// 1) Optionen genutzt (user, anzahl)  -> direkte Reduktion
// 2) keine Optionen                   -> Dropdown mit allen Usern (jede Auswahl -1)
//
// Nur für Mods (hasModPerm).

import { hasModPerm } from "../services/permissions.mjs";

export const name = "reducew";
export const description = "Wins eines Users reduzieren (Dropdown + direkte Option)";

// ---- Helpers ---------------------------------------------------------------

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
  // Discord: max 25 Optionen
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

// Holt Options roh aus der Interaction (weil getUser im Projekt nicht verdrahtet ist)
function getRawOption(ctx, name) {
  const ops = ctx.interaction?.data?.options || [];
  return ops.find((o) => o?.name === name)?.value ?? null;
}

// ---- Command ---------------------------------------------------------------

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

    // 1) Versuche direkte Reduktion, falls Options angegeben wurden
    const userIdOpt = getRawOption(ctx, "user");     // USER-Option liefert direkt die Snowflake-ID
    const amountOpt = getRawOption(ctx, "anzahl");   // INTEGER
    const amount = Math.max(1, Number(amountOpt ?? 1) || 1);

    if (userIdOpt) {
      // Direkte Reduktion
      const { rows, rowCount } = await db.query(
        `
        UPDATE wins
           SET win_count = GREATEST(win_count - $3, 0),
               updated_at = NOW()
         WHERE guild_id = $1
           AND user_id  = $2
        RETURNING win_count
        `,
        [guildId, userIdOpt, amount]
      );

      if (rowCount === 0) {
        return ctx.reply(`⚠️ Für <@${userIdOpt}> existiert kein Wins-Eintrag.`, {
          ephemeral: true,
        });
      }

      const newCount = rows[0].win_count;
      return ctx.reply(
        `✅ Reduziert: <@${userIdOpt}> um **${amount}** · neuer Stand **W${newCount}**.`,
        { ephemeral: true }
      );
    }

    // 2) Keine Options → Dropdown zeigen
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
