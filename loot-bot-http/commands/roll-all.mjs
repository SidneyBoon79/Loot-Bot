// commands/roll-all.mjs
// Globaler Win-Count über alle Items (48h)

export const id = "roll-all";
export const description = "Würfelt alle Items gleichzeitig aus.";

const d20 = () => Math.floor(Math.random() * 20) + 1;
const PRIO = { gear: 2, trait: 1, litho: 0 };
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

  // Alle offenen Items der letzten 48h
  const { rows: items } = await ctx.db.query(
    `
    SELECT DISTINCT item_slug, item_name
    FROM votes
    WHERE guild_id = $1
      AND created_at > NOW() - INTERVAL '48 hours'
    `,
    [guildId]
  );

  if (!items?.length) {
    return ctx.reply("ℹ️ Keine Items zum Auswürfeln gefunden.");
  }

  let messages = [];

  for (const it of items) {
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
      wins48 AS (   -- ✨ global über alle Items
        SELECT user_id, COUNT(*)::int AS wins
        FROM winners
        WHERE guild_id = $1
          AND won_at > NOW() - INTERVAL '48 hours'
        GROUP BY user_id
      )
      SELECT l.user_id, l.reason, COALESCE(w.wins,0) AS wins
      FROM latest l
      LEFT JOIN wins48 w USING (user_id)
      `,
      [guildId, it.item_slug]
    );

    if (!participants?.length) {
      messages.push(`ℹ️ Keine Teilnehmer für **${it.item_name}**.`);
      continue;
    }

    let rolled = participants.map((p) => ({ ...p, roll: d20() })).sort(cmp);
    const winner = rolled[0];

    // Log in winners
    await ctx.db.query(
      `
      INSERT INTO winners (guild_id, item_slug, user_id, won_at, window_end_at)
      VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '48 hours')
      `,
      [guildId, it.item_slug, winner.user_id]
    );

    // Gewinner-Wins neu (✨ global über alle Items)
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
      `🎲 Roll-Ergebnis für **${it.item_name}**:\n${lines.join(
        "\n"
      )}\n\n🏆 Gewinner: <@${winner.user_id}> — ${emoji(
        winner.reason
      )} ${winner.reason} · Wurf ${winner.roll} (W${winnerWinCount})`
    );
  }

  return ctx.reply(messages.join("\n\n"));
}

export default { id, description, run };
