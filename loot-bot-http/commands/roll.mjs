// commands/roll.mjs
// /roll – rollt EIN bestimmtes Item fair aus
// Sortierung: Grund (⚔️>💠>📜) > Wins (aufsteigend) > Wurf (absteigend)
// Erwartet (idealerweise) eine Option "item"; falls die in deinem Registrar noch nicht existiert,
// bekommst du eine Liste der offenen Items zurück und kannst das Item namentlich angeben,
// bis wir die Dropdown-UI verdrahten.

const REASON_WEIGHT = { gear: 3, trait: 2, litho: 1 };

function reasonLabel(t) {
  if (t === "gear") return "⚔️ Gear";
  if (t === "trait") return "💠 Trait";
  if (t === "litho") return "📜 Litho";
  return t;
}
function medal(i) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  const map = { 3: "4️⃣", 4: "5️⃣", 5: "6️⃣", 6: "7️⃣", 7: "8️⃣", 8: "9️⃣", 9: "🔟" };
  return map[i] || `${i + 1}.`;
}

function indexByName(options = []) {
  const map = Object.create(null);
  for (const o of options) map[o.name] = o;
  return map;
}

function normalizeItem(raw) {
  return (raw ?? "").trim().slice(0, 200);
}

export async function run(ctx) {
  ctx.requireMod?.(); // Mods only
  await ensureSchema(ctx.db);

  const opt = indexByName(ctx.options);
  const itemNameInput = normalizeItem(opt.item?.value ?? "");

  // Falls kein Item übergeben wurde: Liste offener Items zeigen (mit Votes im 48h-Fenster)
  if (!itemNameInput) {
    const open = await openItemsWithVotes(ctx.db, ctx.guildId);
    if (open.length === 0) {
      return ctx.reply("Keine **offenen Items mit Votes** im 48h-Fenster gefunden. ✅", { ephemeral: true });
    }
    const list = open.map(x => `• ${x.item_name} — ${x.c_votes} Votes`).join("\n");
    return ctx.reply(
      "Gib bitte ein Item an (`/roll item:<Name>`), bis das Dropdown-UI verdrahtet ist.\n" +
      "**Offene Items:**\n" + list,
      { ephemeral: true }
    );
  }

  // Prüfen, ob es für das Item überhaupt Votes im 48h-Fenster gibt
  const hasVotes = await hasVotes48h(ctx.db, ctx.guildId, itemNameInput);
  if (!hasVotes) {
    return ctx.reply(`Für **${itemNameInput}** gibt’s aktuell keine gültigen Votes (48h).`, { ephemeral: true });
  }

  // Teilnehmer aggregieren: pro User der "beste" Grund (Gear > Trait > Litho)
  const voters = await topReasonPerUser(ctx.db, ctx.guildId, itemNameInput);
  if (voters.length === 0) {
    return ctx.reply(`Keine Teilnehmer für **${itemNameInput}**.`, { ephemeral: true });
  }

  // Für jeden Teilnehmer: Wins (Debuff) + Wurf
  for (const v of voters) {
    v.display = `<@${v.user_id}>`; // mentions statt REST-User-Lookup (serverless-freundlich)
    v.roll = Math.floor(Math.random() * 100) + 1;

    const { rows } = await ctx.db.query(
      `SELECT win_count FROM wins WHERE guild_id=$1 AND user_id=$2`,
      [ctx.guildId, v.user_id]
    );
    v.wins = rows.length ? Number(rows[0].win_count) || 0 : 0;
  }

  // Sortierung: Grund (desc) > Wins (asc) > Roll (desc)
  voters.sort((a, b) => {
    const r = (REASON_WEIGHT[b.reason] ?? 0) - (REASON_WEIGHT[a.reason] ?? 0);
    if (r !== 0) return r;
    const w = a.wins - b.wins;
    if (w !== 0) return w;
    return b.roll - a.roll;
  });

  const winner = voters[0];

  // DB-Updates: Item flaggen + Wins des Gewinners +1
  await ctx.db.query(
    `UPDATE items
        SET rolled = TRUE, winner_id = $3, rolled_by = $4, rolled_at = NOW()
      WHERE guild_id = $1 AND item_name = $2`,
    [ctx.guildId, itemNameInput, winner.user_id, ctx.userId]
  );

  await ctx.db.query(
    `INSERT INTO wins (guild_id, user_id, win_count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET win_count = wins.win_count + 1, updated_at = NOW()`,
    [ctx.guildId, winner.user_id]
  );

  // Ausgabe bauen
  const lines = voters.map((v, i) => {
    return `${medal(i)} ${v.display} — ${v.roll} (${reasonLabel(v.reason)} | ${v.wins}W)`;
  }).join("\n");

  const winnerLine = `🏆 Gewinner: ${winner.display} (${reasonLabel(winner.reason)} | ${winner.wins + 1}W)`;

  // Public im Channel posten (FollowUp), kurze ephemere Bestätigung an den Mod
  await ctx.followUp({
    content: `🎲 Würfelrunde für **${itemNameInput}**\n\n${lines}\n\n${winnerLine}`
  }, { ephemeral: false });

  return ctx.reply(`Roll für **${itemNameInput}** veröffentlicht.`, { ephemeral: true });
}

/* ===== Helpers / SQL ===== */

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      reason     TEXT NOT NULL CHECK (reason IN ('gear','trait','litho')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, user_id, item_name)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS items (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      item_name  TEXT NOT NULL,
      rolled     BOOLEAN NOT NULL DEFAULT FALSE,
      winner_id  TEXT,
      rolled_by  TEXT,
      rolled_at  TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, item_name)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS wins (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      win_count  INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS votes_guild_created_idx ON votes (guild_id, created_at);`);
}

async function openItemsWithVotes(db, guildId) {
  const { rows } = await db.query(
    `
    WITH windowed AS (
      SELECT * FROM votes
       WHERE guild_id=$1 AND created_at > NOW() - INTERVAL '48 hours'
    )
    SELECT i.item_name,
           COALESCE(SUM(CASE WHEN w.item_name IS NOT NULL THEN 1 ELSE 0 END),0)::int AS c_votes
      FROM items i
 LEFT JOIN windowed w
        ON w.guild_id=i.guild_id AND w.item_name=i.item_name
     WHERE i.guild_id=$1 AND i.rolled=FALSE
  GROUP BY i.item_name
    HAVING COALESCE(SUM(CASE WHEN w.item_name IS NOT NULL THEN 1 ELSE 0 END),0) > 0
  ORDER BY i.item_name ASC
    `,
    [guildId]
  );
  return rows;
}

async function hasVotes48h(db, guildId, itemName) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c
       FROM votes
      WHERE guild_id=$1 AND item_name=$2
        AND created_at > NOW() - INTERVAL '48 hours'`,
    [guildId, itemName]
  );
  return (rows[0]?.c ?? 0) > 0;
}

async function topReasonPerUser(db, guildId, itemName) {
  const { rows } = await db.query(
    `
    SELECT user_id,
           CASE MAX(CASE reason WHEN 'gear' THEN 3 WHEN 'trait' THEN 2 WHEN 'litho' THEN 1 ELSE 0 END)
             WHEN 3 THEN 'gear' WHEN 2 THEN 'trait' ELSE 'litho' END AS reason
      FROM votes
     WHERE guild_id=$1 AND item_name=$2
       AND created_at > NOW() - INTERVAL '48 hours'
  GROUP BY user_id
    `,
    [guildId, itemName]
  );
  return rows;
}
