// commands/roll-all.mjs
// Würfelt alle offenen Items der letzten 48h aus (noch nicht gerollt).
// Reihenfolge: Gear > Trait > Litho.
// Speicherung ausschließlich in `wins` (Snapshot je User) per UPSERT.

export const id = "roll-all";
export const description = "Würfelt alle Items gleichzeitig aus.";

const d100 = () => Math.floor(Math.random() * 100) + 1;
const PRIO = { gear: 3, trait: 2, litho: 1 };

const emoji = (r) =>
  ({ gear: "🗡️", trait: "💠", litho: "📜" }[String(r || "").toLowerCase()] || "❔");
const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "–");

// Sortierung innerhalb eines Items: Reason-Prio ↓ → WinCount ↑ → Roll ↓
const cmpParticipant = (a, b) => {
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0);
  if (g) return g;
  const w = (a.wins ?? 0) - (b.wins ?? 0);
  if (w) return w;
  return (b.roll ?? 0) - (a.roll ?? 0);
};

export async function run(ctx) {
  try {
    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;
    if (!guildId) {
      return ctx.reply("❌ Konnte die Guild-ID nicht ermitteln.", { ephemeral: true });
    }

    // Alle Items der letzten 48h, die noch nicht gerollt wurden (laut wins.rolled_at)
    const { rows: items } = await db.query(
      `
      WITH latest AS (
        SELECT DISTINCT ON (item_slug, user_id)
               item_slug,
               user_id,
               LOWER(reason) AS reason,
               MIN(item_name_first) OVER (PARTITION BY item_slug) AS item_name_first,
               created_at
        FROM votes
        WHERE guild_id = $1
          AND created_at > NOW() - INTERVAL '48 hours'
        ORDER BY item_slug, user_id, created_at DESC
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
      WHERE NOT EXISTS (
        SELECT 1
        FROM wins w
        WHERE w.guild_id = $1
          AND w.item_slug = b.item_slug
          AND w.rolled_at > NOW() - INTERVAL '48 hours'
      )
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

      // Teilnehmer: jüngster Vote je User + aktueller Gesamt-WinCount aus wins
      const { rows: participants } = await db.query(
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
        totals AS (
          SELECT user_id, MAX(win_count)::int AS wins
          FROM wins
          WHERE guild_id = $1
          GROUP BY user_id
        )
        SELECT l.user_id, l.reason, COALESCE(t.wins, 0) AS wins
        FROM latest l
        LEFT JOIN totals t USING (user_id)
        `,
        [guildId, itemSlug]
      );

      if (!participants?.length) {
        messages.push(`ℹ️ Keine Teilnehmer für **${itemName}** gefunden.`);
        continue;
      }

      for (const p of participants) p.roll = d100();
      participants.sort(cmpParticipant);

      const winner = participants[0];

      // bisherigen WinCount lesen (bei PK je User existiert max. eine Zeile)
      const { rows: prevWinRows } = await db.query(
        `SELECT COALESCE(MAX(win_count), 0)::int AS wins
         FROM wins
         WHERE guild_id = $1 AND user_id = $2`,
        [guildId, winner.user_id]
      );
      const newWinCount = (prevWinRows?.[0]?.wins ?? 0) + 1;

      // UPSERT: Snapshot-Zeile je User aktualisieren
      await db.query(
        `INSERT INTO wins (
           guild_id, user_id, win_count, updated_at,
           item_slug, item_name_first, winner_user_id, reason, rolled_at, roll_value
         ) VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,NOW(),$8)
         ON CONFLICT (guild_id, user_id) DO UPDATE
         SET win_count = EXCLUDED.win_count,
             updated_at = NOW(),
             item_slug = EXCLUDED.item_slug,
             item_name_first = EXCLUDED.item_name_first,
             winner_user_id = EXCLUDED.winner_user_id,
             reason = EXCLUDED.reason,
             rolled_at = NOW(),
             roll_value = EXCLUDED.roll_value`,
        [
          guildId,
          winner.user_id,
          newWinCount,
          itemSlug,
          itemName,
          winner.user_id,
          winner.reason,
          winner.roll,
        ]
      );

      const lines = participants.map((p, i) =>
        `${medal(i)} <@${p.user_id}> — ${emoji(p.reason)} ${p.reason} · Wurf ${p.roll} (W${p.wins})`
      );

      messages.push(
        `🎲 Roll-Ergebnis für **${itemName}**:\n${lines.join("\n")}\n\n🏆 Gewinner: <@${winner.user_id}> — ${emoji(
          winner.reason
        )} ${winner.reason} · Wurf ${winner.roll} (W${newWinCount})`
      );
    }

    return ctx.reply(messages.join("\n\n"));
  } catch (e) {
    console.error("[commands/roll-all] error:", e);
    return ctx.reply("❌ Da ging was schief.", { ephemeral: true });
  }
}

export default { id, description, run };
