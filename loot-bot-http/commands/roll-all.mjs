// commands/roll-all.mjs

// Würfelt alle offenen Items der letzten 48h aus, die noch nicht gerollt wurden.
// Reihenfolge der Items: erst Gear, dann Trait, dann Litho (basierend auf jüngstem Vote je User).
// Win-Count wird GLOBAL aus Tabelle `wins` gezählt und dort auch inkrementiert.

export const id = "roll-all";
export const description = "Würfelt alle Items gleichzeitig aus.";

const d100 = () => Math.floor(Math.random() * 100) + 1; // 1–100
const PRIO = { gear: 3, trait: 2, litho: 1 };

const emoji = (r) => (
  { gear: "🗡️", trait: "💠", litho: "📜" }[String(r || "").toLowerCase()] || "❔"
);
const medal = (i) =>
  i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "–";

// Comparator innerhalb eines Items: Gear > Trait > Litho → Wins (ASC) → Roll (DESC)
const cmpParticipant = (a, b) => {
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0);
  if (g) return g;
  const w = (a.wins ?? 0) - (b.wins ?? 0);
  if (w) return w;
  return (b.roll ?? 0) - (a.roll ?? 0);
};

export async function run(ctx) {
  const guildId = ctx.guildId;

  // Alle offenen Items (48h), die noch NICHT in winners stehen.
  // Priorität pro Item: max(reason) über jüngste Votes je User → Gear(3) > Trait(2) > Litho(1)
  const { rows: items } = await ctx.db.query(
    `
    WITH latest AS (
      SELECT DISTINCT ON (item_slug, user_id)
             item_slug,
             user_id,
             LOWER(reason) AS reason,
             item_name_first,
             created_at
      FROM votes
      WHERE guild_id = $1
        AND created_at > NOW() - INTERVAL '48 hours'
      ORDER BY item_slug, user_id, created_at DESC
    ),
    rolled AS (
      SELECT DISTINCT item_slug
      FROM winners
      WHERE guild_id = $1
        AND won_at > NOW() - INTERVAL '48 hours'
    ),
    by_item AS (
      SELECT
        l.item_slug,
        MIN(l.item_name_first) AS item_name_first,
        MAX(CASE l.reason WHEN 'gear' THEN 3 WHEN 'trait' THEN 2 WHEN 'litho' THEN 1 ELSE 0 END)::int AS prio
      FROM latest l
      GROUP BY l.item_slug
    )
    SELECT b.item_slug, b.item_name_first, b.prio
    FROM by_item b
    LEFT JOIN rolled r ON r.item_slug = b.item_slug
    WHERE r.item_slug IS NULL
    ORDER BY b.prio DESC, b.item_name_first ASC
    `,
    [guildId]
  );

  if (!items?.length) {
    return ctx.reply("ℹ️ Keine Items zum Auswürfeln gefunden.");
  }

  const messages = [];

  for (const it of items) {
    const itemSlug = it.item_slug;
    const itemName = it.item_name_first ?? itemSlug;

    // Teilnehmer: jüngster Vote je User (48h) + GLOBALER Win-Count aus wins
    const { rows: participants } = await ctx.db.query(
      `
      WITH latest AS (
        SELECT DISTINCT ON (user_id)
               user_id, LOWER(reason) AS reason, created_at
        FROM votes
        WHERE guild_id = $1
          AND item_slug = $2
          AND created_at > NOW() - INTERVAL '48 hours'
        ORDER BY user_id, created_at DESC
      ),
      wins_now AS (
        SELECT user_id, win_count::int AS wins
        FROM wins
        WHERE guild_id = $1
      )
      SELECT l.user_id, l.reason, COALESCE(w.wins, 0) AS wins
      FROM latest l
      LEFT JOIN wins_now w USING (user_id)
      `,
      [guildId, itemSlug]
    );

    if (!participants?.length) {
      messages.push(`ℹ️ Keine Teilnehmer für **${itemName}** gefunden.`);
      continue;
    }

    // Würfeln & sortieren
    for (const p of participants) {
      p.roll = d100();
    }
    participants.sort(cmpParticipant);

    const winner = participants[0];
    const winnerWinCount = (winner.wins ?? 0) + 1;

    // Gewinner persistieren
    await ctx.db.query(
      `INSERT INTO winners (guild_id, item_slug, user_id, reason, roll, won_at, item_name_first)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [guildId, itemSlug, winner.user_id, winner.reason, winner.roll, itemName]
    );

    // Wins global hochzählen (UPSERT)
    await ctx.db.query(
      `INSERT INTO wins (guild_id, user_id, win_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET win_count = wins.win_count + 1`,
      [guildId, winner.user_id]
    );

    const lines = participants.map((p, i) =>
      `${medal(i)} <@${p.user_id}> — ${emoji(p.reason)} ${p.reason} · Wurf ${p.roll} (W${p.wins})`
    );

    messages.push(
      `🎲 Roll-Ergebnis für **${itemName}**:\n${lines.join("\n")}\n\n🏆 Gewinner: <@${winner.user_id}> — ${emoji(winner.reason)} ${winner.reason} · Wurf ${winner.roll} (W${winnerWinCount})`
    );
  }

  return ctx.reply(messages.join("\n\n"));
}

export default { id, description, run };
