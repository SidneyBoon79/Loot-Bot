// commands/reducew.mjs — Mod-Only: User mit Wins auswählen, dann per Modal Anzahl reduzieren (niemals < 0)

function fmt(n){ return new Intl.NumberFormat("de-DE").format(Number(n)||0); }

export async function run(ctx) {
  ctx.requireMod?.();

  // User mit Win-Count > 0
  const { rows } = await ctx.db.query(
    `SELECT user_id, win_count
       FROM wins
      WHERE guild_id=$1
        AND win_count > 0
      ORDER BY user_id ASC
      LIMIT 25`,
    [ctx.guildId]
  );

  if (!rows.length) {
    return ctx.reply("Keine User mit Wins gefunden. ✅", { ephemeral: true });
  }

  const optionsArr = rows.map(r => ({
    label: `@${r.user_id} · (W${fmt(r.win_count)})`,
    value: r.user_id,
    description: `Wins: ${fmt(r.win_count)}`
  }));

  const select = {
    type: 1,
    components: [
      { type: 3, custom_id: "reducew:select", placeholder: "User auswählen …", min_values: 1, max_values: 1, options: optionsArr }
    ]
  };

  return ctx.reply({ content: "Wähle den User, dessen Wins du reduzieren willst:", components: [select] }, { ephemeral: true });
}

// Modal definieren
export function makeModal(userId) {
  return {
    custom_id: "reducew:modal",
    title: "Wins reduzieren",
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

  // Update
  if (cur.rowCount === 0) {
    // nichts zu reduzieren
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

  return ctx.followUp(`Wins für <@${targetUser}> um ${delta} reduziert. Neuer Stand: (W${fmt(after)})`, { ephemeral: true });
}
