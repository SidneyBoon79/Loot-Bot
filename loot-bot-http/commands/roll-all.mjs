// commands/roll-all.mjs
// Würfelt alle offenen Items der letzten 48h aus, die noch nicht gerollt wurden.
// Win-Count wird GLOBAL über alle Items innerhalb von 48h gezählt (aus Tabelle `winners`).

export const id = "roll-all";
export const description = "Würfelt alle Items gleichzeitig aus.";

const d20 = () => Math.floor(Math.random() * 100) + 1;
const PRIO = { gear: 3, trait: 2, litho: 1 }; // Gear zuerst, dann Trait, dann Litho
const cmp = (a, b) => {
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0);
  if (g) return g;
  const w = (a.wins ?? 0) - (b.wins ?? 0);
  if (w) return w;
  return (b.roll ?? 0) - (a.roll ?? 0);
};
const emoji = (r) =>
  ({ gear: "🗡️", trait: "💠", litho: "📜" }[String(r || "").toLowerCase()] || "❔");
const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "–");

export async function run(ctx) {
  const guildId = ctx.guildId;

  // Alle offenen Items der letzten 48h, die NICHT in winners stehen
  const { rows: items } = await ctx.db.query(
    `
    WITH voted AS (
      SELECT DISTINCT item_slug, item_name_first
      FROM votes
      WHERE guild_id = $1
        AND created_at > NOW() - INTERVAL '48 hours'
    ),
    rolled AS (
      SELECT DISTINCT item_slug
      FROM winners
      WHERE guild_id = $1
        AND won_at > NOW() - INTERVAL '48 hours'
    )
    SELECT v.item_slug, v.item_name_first
    FROM voted v
    WHERE NOT EXISTS (
      SELECT 1 FROM rolled r WHERE r.item_slug = v.item_slug
    )
    `,
    [guildId]
  );

  if (!items?.length) {
    return ctx.reply("ℹ️ Keine Items zum Auswürfeln gefunden.");
  }

  let messages = [];

  for (const it of items) {
    const itemSlug = it.item_slug;
    const itemName = it.item_name_first ?? itemSlug;

    // Teilnehmer: letzter Vote pro User für dieses Item (48h)
    // + GLOBALER Win-Count aus winners (48h, ohne item_slug-Filter)
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
      wins48 AS (
        SELECT user_id, COUNT(*)::int AS wins
        FROM winners
        WHERE guild_id = $1
          AND won_at > NOW() - INTERVAL '48 hours'
        GROUP BY user_id
      )
      SELECT l.user_id, l.reason, COALESCE(w.wins, 0) AS wins
      FROM latest l
      LEFT JOIN wins48 w USING (user_id)
      `,
      [guildId, itemSlug]
    );

    if (!participants?.length) {
      messages.push(`ℹ️ Keine Teilnehmer für **${itemName}**.`);
      continue;
    }

    // Würfeln + sortieren: Gear > Trait > Litho -> Wins (ASC) -> Roll (DESC)
    let rolled = participants.map((p) => ({ ...p, roll: d20() })).sort(cmp);
    const winner = rolled[0];

    // Gewinner im winners-Log festhalten (für 48h-Fenster)
    await ctx.db.query(
      `
      INSERT INTO winners (guild_id, item_slug, user_id, won_at, window_end_at)
      VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '48 hours')
      `,
      [guildId, itemSlug, winner.user_id]
    );

    // Gewinner-Wins neu berechnen (GLOBAL über alle Items, 48h)
    const { rows: wcount } = await ctx.db.query(
      `
      SELECT COUNT(*)::int AS c
      FROM winners
      WHERE guild_id = $1
        AND user_id   = $2
        AND won_at > NOW() - INTERVAL '48 hours'
      `,
      [guildId, winner.user_id]
    );
    const winnerWinCount = wcount?.[0]?.c ?? 1;

    const lines = rolled.map(
      (p, i) =>
        `${medal(i)} <@${p.user_id}> — ${emoji(p.reason)} ${p.reason} · ${p.roll} (W${p.wins})`
    );

    messages.push(
      `🎲 Roll-Ergebnis für **${itemName}**:\n${lines.join(
        "\n"
      )}\n\n🏆 Gewinner: <@${winner.user_id}> — ${emoji(
        winner.reason
      )} ${winner.reason} · Wurf ${winner.roll} (W${winnerWinCount})`
    );
  }

  return ctx.reply(messages.join("\n\n"));
}

export default { id, description, run };
