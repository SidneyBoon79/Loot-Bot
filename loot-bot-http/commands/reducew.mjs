// commands/reducew.mjs — Mod-Only: User per USER-SELECT wählen (zeigt Namen!), dann Modal für Anzahl

function fmt(n){ return new Intl.NumberFormat("de-DE").format(Number(n)||0); }

export async function run(ctx) {
  ctx.requireMod?.();

  // USER_SELECT statt String-Select => Discord zeigt echte Namen/Avatare
  const userSelectRow = {
    type: 1,
    components: [
      {
        type: 5, // USER_SELECT
        custom_id: "reducew:userpick",
        placeholder: "User auswählen …",
        min_values: 1,
        max_values: 1
      }
    ]
  };

  return ctx.reply(
    { content: "Wähle den User, dessen Wins du reduzieren willst:", components: [userSelectRow] },
    { ephemeral: true }
  );
}

// Modal definieren
export function makeModal(userId, currentWins = null) {
  const winsHint = currentWins == null ? "" : ` (aktuell: W${fmt(currentWins)})`;
  return {
    custom_id: "reducew:modal",
    title: `Wins reduzieren${winsHint}`,
    components: [
      {
        type: 1,
        components: [
          { type: 4, custom_id: "reducew:user", style: 1, label: "User ID", value: userId, required: true }
        ]
      },
      {
        type: 1,
        components: [
          { type: 4, custom_id: "reducew:count", style: 1, label: "Anzahl (mind. 1)", placeholder: "1", required: true }
        ]
      }
    ]
  };
}

export async function handleModalSubmit(ctx) {
  const comps = ctx.interaction?.data?.components ?? [];
  const userComp  = comps[0]?.components?.[0];
  const countComp = comps[1]?.components?.[0];

  const targetUser = (userComp?.value || "").trim();
  const rawCount   = (countComp?.value || "").trim();
  const delta = Math.max(1, Math.floor(Number(rawCount)));

  if (!targetUser) return ctx.followUp("User fehlt.", { ephemeral: true });
  if (!Number.isFinite(delta) || delta < 1) return ctx.followUp("Ungültige Anzahl.", { ephemeral: true });

  // aktuelle Wins holen
  const cur = await ctx.db.query(
    `SELECT win_count FROM wins WHERE guild_id=$1 AND user_id=$2`,
    [ctx.guildId, targetUser]
  );
  const before = cur.rows[0]?.win_count ?? 0;
  const after  = Math.max(0, Number(before) - delta);

  if (cur.rowCount === 0 || before <= 0) {
    await ctx.followUp(`User <@${targetUser}> hat (W0). Nichts zu tun.`, { ephemeral: true });
    return;
  }

  await ctx.db.query(
    `UPDATE wins
        SET win_count = $3,
            updated_at = NOW()
      WHERE guild_id=$1 AND user_id=$2`,
    [ctx.guildId, targetUser, after]
  );

  return ctx.followUp(`Wins für <@${targetUser}> um ${delta} reduziert. Neuer Stand: (W${after})`, { ephemeral: true });
}
