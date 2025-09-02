// commands/reducew.mjs — Mod-Only: Nur Gewinner (win_count > 0) auswählbar, mit Namens-Cache

function fmt(n) {
  return new Intl.NumberFormat("de-DE").format(Number(n) || 0);
}

export async function run(ctx) {
  ctx.requireMod?.();

  // Gewinner + evtl. gecachter Anzeigename
  const { rows } = await ctx.db.query(
    `SELECT w.user_id,
            w.win_count,
            COALESCE(m.display_name, w.user_id::text) AS display_name
       FROM wins w
       LEFT JOIN members m
              ON m.guild_id = w.guild_id
             AND m.user_id  = w.user_id
      WHERE w.guild_id = $1
        AND w.win_count > 0
      ORDER BY w.win_count DESC, display_name ASC
      LIMIT 25`,
    [ctx.guildId]
  );

  if (!rows.length) {
    return ctx.reply("Keine User mit Wins vorhanden. ✅", { ephemeral: true });
    }

  const options = rows.map(r => ({
    // Hinweis: echte Mentions werden in Select-Labels nicht gerendert.
    // Wir zeigen daher Klartext-Name aus Cache + W-Stand.
    label: `${r.display_name} · W${fmt(r.win_count)}`,
    value: String(r.user_id),
    description: `aktueller Stand: W${fmt(r.win_count)}`
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
            style: 1,
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
            style: 1,
            label: "Anzahl (mind. 1)",
            placeholder: "1",
            required: true
          }
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

  if (!targetUser) return ctx.followUp("❌ User fehlt.", { ephemeral: true });
  if (!Number.isFinite(delta) || delta < 1) return ctx.followUp("❌ Ungültige Anzahl.", { ephemeral: true });

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
