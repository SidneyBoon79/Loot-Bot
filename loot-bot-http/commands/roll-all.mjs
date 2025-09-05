// commands/roll-all.mjs
// Rollt alle offenen Items (48h Votes, noch nicht gewonnen) in zufälliger Reihenfolge.
// Ranking identisch zu /roll: Reason-Prio > Wins(ASC) > Roll(DESC).
// Persistenz: winners-Log + wins-Upsert (+1) je Gewinner.

import { hasModPerm } from "../services/permissions.mjs";

export const name = "roll-all";
export const description = "Alle offenen Items rollen (Mods)";

const PRIO = { gear: 2, trait: 1, litho: 0 };
const emoji = (r) => ({ gear: "🗡️", trait: "💠", litho: "📜" }[String(r || "").toLowerCase()] || "❔");
const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "➖");
const d20 = () => Math.floor(Math.random() * 20) + 1;

function cmp(a, b) {
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0);
  if (g) return g;
  const w = (a.wins ?? 0) - (b.wins ?? 0);
  if (w) return w;
  return (b.roll ?? 0) - (a.roll ?? 0);
}

export async function run(ctx) {
  try {
    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    const db = ctx.db;
    if (!db) return ctx.reply("❌ Datenbank nicht verfügbar.", { ephemeral: true });

    const guildId =
      (typeof ctx.guildId === "function" ? ctx.guildId() : ctx.guildId) ??
      ctx.guild_id ?? ctx.guild?.id ?? null;

    if (!guildId) {
      return ctx.reply("❌ Konnte die Guild-ID nicht ermitteln.", { ephemeral: true });
    }

    // Alle Items mit aktiven Votes (48h), die NICHT bereits gewonnen wurden (48h)
    const { rows: items } = await db.query(
      `
      WITH voted AS (
        SELECT item_slug, MIN(item_name_first) AS item_name, COUNT(*)::int AS votes
        FROM votes
        WHERE guild_id = $1
          AND created_at > NOW() - INTERVAL '48 hours'
        GROUP BY item_slug
      ),
      blocked AS (
        SELECT DISTINCT item_slug
        FROM winners
        WHERE guild_id = $1
          AND won_at   > NOW() - INTERVAL '48 hours'
      )
      SELECT v.item_slug, v.item_name, v.votes
      FROM voted v
      WHERE NOT EXISTS (SELECT 1 FROM blocked b WHERE b.item_slug = v.item_slug)
      `,
      [guildId]
    );

    if (!items?.length) {
      return ctx.reply("ℹ️ Keine offenen Items (48h) zum Rollen.", { ephemeral: true });
    }

    // Zufällige Reihenfolge zur Fairness zwischen Items
    const shuffled = [...items].sort(() => Math.random() - 0.5);

    const allOutputs = [];

    for (const it of shuffled) {
      // Teilnehmer je Item:
      // - neuester Reason pro User aus votes (48h)
      // - Wins (48h) aus winners für dieses Item
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
        wins48 AS (
          SELECT user_id, COUNT(*)::int AS wins
          FROM winners
          WHERE guild_id = $1
            AND item_slug = $2
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
        // Falls keine qualifizierten Teilnehmer (sollte selten sein) – skippen.
        continue;
      }

      // Würfeln & sortieren wie bei /roll
      const rolled = participants.map((p) => ({ ...p, roll: d20() })).sort(cmp);

      // Sudden Death bei komplettem Gleichstand
      const top = rolled.filter((e) => cmp(e, rolled[0]) === 0);
      const equal = (a, b) =>
        (PRIO[a.reason] ?? 0) === (PRIO[b.reason] ?? 0) &&
        (a.wins ?? 0) === (b.wins ?? 0) &&
        (a.roll ?? 0) === (b.roll ?? 0);

      let winner = top[0];
      if (top.length > 1 && top.every((x) => equal(x, top[0]))) {
        let pool = [...top];
        for (let i = 0; i < 10; i++) {
          pool = pool.map((x) => ({ ...x, roll: d20() })).sort(cmp);
          const g = pool.filter((e) => cmp(e, pool[0]) === 0);
          if (g.length === 1) {
            winner = pool[0];
            winner._tieBreak = true;
            break;
          }
        }
      }

      // Persistenz: winners-Log + wins-Upsert (+1)
      try {
        await db.query("BEGIN");

        await db.query(
          `
          INSERT INTO winners (guild_id, item_slug, user_id, won_at, window_end_at)
          VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '48 hours')
          `,
          [guildId, it.item_slug, winner.user_id]
        );

        await db.query(
          `
          INSERT INTO wins
            (guild_id, user_id, win_count, updated_at, item_slug, item_name_first, winner_user_id, reason, rolled_at, roll_value)
          VALUES
            ($1,      $2,     1,         NOW(),      $3,        $4,              $2,            $5,     NOW(),    $6)
          ON CONFLICT (guild_id, user_id)
          DO UPDATE SET
            win_count       = wins.win_count + 1,
            updated_at      = NOW(),
            rolled_at       = NOW(),
            item_slug       = EXCLUDED.item_slug,
            item_name_first = EXCLUDED.item_name_first,
            winner_user_id  = EXCLUDED.winner_user_id,
            reason          = EXCLUDED.reason,
            roll_value      = EXCLUDED.roll_value
          `,
          [guildId, winner.user_id, it.item_slug, it.item_name, winner.reason, winner.roll]
        );

        await db.query("COMMIT");
      } catch (e) {
        try { await db.query("ROLLBACK"); } catch {}
        console.error("[roll-all persist]", e?.message || e);
      }

      // Gewinner-Wins für Anzeige (48h aus winners gezählt)
      let winnerWinCount = 1;
      try {
        const { rows: wcount } = await db.query(
          `
          SELECT COUNT(*)::int AS c
          FROM winners
          WHERE guild_id = $1
            AND item_slug = $2
            AND user_id   = $3
            AND won_at > NOW() - INTERVAL '48 hours'
          `,
          [guildId, it.item_slug, winner.user_id]
        );
        winnerWinCount = wcount?.[0]?.c ?? 1;
      } catch {}

      // Ausgabe im Stil der alten Datei
      const lines = rolled.map((c, idx) => {
        const rTxt = (c.reason || "").toLowerCase();
        const suffixWins = typeof c.wins === "number" ? ` (W${c.user_id === winner.user_id ? winnerWinCount : c.wins})` : "";
        return `${medal(idx)} <@${c.user_id}> — ${emoji(rTxt)} ${rTxt} · ${c.roll}${suffixWins}`;
      });

      const header = `🎲 Roll-Ergebnis für **${it.item_name}**${winner._tieBreak ? " (Tie-Break)" : ""}:`;
      const footer = `\n🏆 Gewinner: <@${winner.user_id}> — ${emoji(winner.reason)} ${winner.reason} · Wurf ${winner.roll} · (W${winnerWinCount})`;

      allOutputs.push(`${header}\n${lines.join("\n")}${footer}`);
    }

    if (!allOutputs.length) {
      return ctx.reply("ℹ️ Keine gültigen Votes gefunden.", { ephemeral: true });
    }

    // Öffentliche, zusammengefasste Ausgabe
    return ctx.reply(allOutputs.join("\n\n"), { ephemeral: false });
  } catch (e) {
    console.error("[commands/roll-all] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler bei /roll-all.", { ephemeral: true });
  }
}

export default { name, description, run };
