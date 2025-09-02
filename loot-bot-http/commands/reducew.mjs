// commands/reducew.mjs — Mod-Only: Nur Gewinner (win_count > 0) auswählbar, dann Modal für Anzahl

function fmt(n) {
  return new Intl.NumberFormat("de-DE").format(Number(n) || 0);
}

/**
 * /reducew
 * Ephemere Nachricht mit String-Select:
 *   - zeigt NUR User aus wins, die win_count > 0 haben
 *   - Sortierung: wins DESC
 */
export async function run(ctx) {
  ctx.requireMod?.();

  const { rows } = await ctx.db.query(
    `SELECT user_id, win_count
       FROM wins
      WHERE guild_id = $1
        AND win_count > 0
      ORDER BY win_count DESC, user_id ASC
      LIMIT 25`,
    [ctx.guildId]
  );

  if (!rows.length) {
    return ctx.reply("Keine User mit Wins vorhanden. ✅", { ephemeral: true });
  }

  // Hinweis: Mentions in Select-Labels werden von Discord NICHT als echte Mentions gerendert.
  // Wir zeigen deshalb den Win-Stand prominent; die Bestätigung/Ergebnis nutzt dann <@id>.
  const options = rows.map(r => ({
    label: `W${fmt(r.win_count)} • ${r.user_id}`, // kompakt erkennbar
    value: String(r.user_id),
    description: `aktueller Stand: W${fmt(r.win_count)}`
    // emoji: { name: "🏅" } // optional
  }));

  const selectRow = {
    type: 1,
    components: [
      {
        type: 3, // STRING_SELECT
        custom_id: "reducew:userpick",
        placeholder: "User mit Wins auswählen …",
        min_values: 1,
        max_values: 1,
        options
      }
    ]
  };

  return ctx.reply(
    {
      content: "Wähle den User, dessen Wins reduziert werden sollen:",
      components: [selectRow]
    },
    { ephemeral: true }
  );
}

/**
 * Baut das Modal. currentWins ist optional (nur Anzeigezweck).
 */
export function makeModal(userId, currentWins = null) {
  const hint = currentWins == null ? "" : ` (aktuell: W${fmt(currentWins)})`;
  return {
    custom_id: "reducew:modal",
    title: `Wins reduzieren${hint}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "reducew:user",
            style: 1, // short text
            label: "User ID",
            value: String(userId),
            required: true
          }
        ]
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: "reducew:count",
            style: 1, // short text
            label: "Anzahl (mind. 1)",
            placeholder: "1",
            required: true
          }
        ]
      }
    ]
  };
}

/**
 * Verarbeitet das Modal: reduziert win_count (niemals unter 0) und bestätigt ephemer.
 */
export async function handleModalSubmit(ctx) {
  const comps = ctx.interaction?.data?.components ?? [];
  const userComp = comps[0]?.components?.[0];
  const countComp = comps[1]?.components?.[0];

  const targetUser = (userComp?.value || "").trim();
  const rawCount = (countComp?.value || "").trim();
  const delta = Math.max(1, Math.floor(Number(rawCount)));

  if (!targetUser) {
    return ctx.followUp("❌ User fehlt.", { ephemeral: true });
  }
  if (!Number.isFinite(delta) || delta < 1) {
    return ctx.followUp("❌ Ungültige Anzahl.", { ephemeral: true });
  }

  // aktuellen Stand holen
  const cur = await ctx.db.query(
    `SELECT win_count FROM wins WHERE guild_id=$1 AND user_id=$2`,
    [ctx.guildId, targetUser]
  );
  const before = cur.rows[0]?.win_count ?? 0;

  if (before <= 0) {
    return ctx.followUp(`User <@${targetUser}> hat bereits (W0). Nichts zu tun.`, { ephemeral: true });
  }

  const after = Math.max(0, Number(before) - delta);

  await ctx.db.query(
    `UPDATE wins
        SET win_count = $3,
            updated_at = NOW()
      WHERE guild_id=$1 AND user_id=$2`,
    [ctx.guildId, targetUser, after]
  );

  return ctx.followUp(
    `Wins für <@${targetUser}> um ${fmt(delta)} reduziert. Neuer Stand: (W${fmt(after)})`,
    { ephemeral: true }
  );
}
