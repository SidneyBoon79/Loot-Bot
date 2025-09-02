// commands/roll-all.mjs
// /roll-all – rollt ALLE noch nicht gerollten Items mit gültigen Votes (48h) in zufälliger Reihenfolge
// - Mods only
// - Für jedes Item: Fair-Sortierung (Grund > Wins(asc) > Wurf(desc))
// - Postet pro Item ein öffentliches Ergebnis und bestätigt dem Mod ephemer

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

export async function run(ctx) {
  ctx.requireMod?.();
  await ensureSchema(ctx.db);

  // Kandidaten holen: alle offenen Items mit Votes im 48h-Fenster
  const items = await openItemsWithVotes(ctx.db, ctx.guildId);
  if (items.length === 0) {
    return ctx.reply("Keine **offenen Items mit gültigen Votes** im 48h-Fenster gefunden. ✅", { ephemeral: true });
  }

  // Zufällige Reihenfolge
  shuffle(items);

  // Für jedes Item rollen
  for (const it of items) {
    const itemName = it.item_name;

    // Teilnehmer aggregieren: pro User der beste Grund (Gear > Trait > Litho)
    const voters = await topReasonPerUser(ctx.db, ctx.guildId, itemName);
    if (voters.length === 0) continue;

    // Wins + Wurf ziehen
    for (const v of voters) {
      v.display = `<@${v.user_id}>`;
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

    // DB-Update: Item flaggen + Wins des Gewinners +1
    await ctx.db.query(
      `UPDATE items
          SET rolled = TRUE, winner_id = $3, rolled_by = $4, rolled_at = NOW()
        WHERE guild_id = $1 AND item_name = $2`,
      [ctx.guildId, itemName, winner.user_id, ctx.userId]
    );

    await ctx.db.query(
      `INSERT INTO wins (guild_id, user_id, win_count, updated_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET win_count = wins.win_count + 1, updated_at = NOW()`,
      [ctx.guildId, winner.user_id]
    );

    // Ausgabe
    const lines = voters.map((v, i) => {
      return `${medal(i)} ${v.display} — ${v.roll} (${reasonLabel(v.reason)} | ${v.wins}W)`;
    }).join("\n");

    const winnerLine = `🏆 Gewinner: ${winner.display} (${reasonLabel(winner.reason)} | ${winner.wins + 1}W)`;

    await ctx.followUp({
      content: `🎲 Würfelrunde für **${itemName}**\n\n${lines}\n\n${winnerLine}`
    }, { ephemeral: false });
  }

  return ctx.reply(`Fertig. **${items.length}** Items wurden gerollt.`, { ephemeral: true });
}

/* ===== Helpers / SQL ===== */

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

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
    SELECT i.item_name
      FROM items i
 LEFT JOIN windowed w
        ON w.guild_id=i.guild_id AND w.item_name=i.item_name
     WHERE i.guild_id=$1 AND i.rolled=FALSE
  GROUP BY i.item_name
    HAVING COUNT(w.item_name) > 0
    `,
    [guildId]
  );
  return rows;
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

