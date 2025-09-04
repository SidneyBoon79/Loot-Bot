// interactions/components/roll-select.mjs
import { hasModPerm } from "../../services/permissions.mjs";

const PRIO = { gear: 2, trait: 1, litho: 0 };

function cmpDisplay(a, b) {
  // 1) Grund (DESC)
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0);
  if (g !== 0) return g;
  // 2) Wins (ASC – weniger Wins bevorzugt)
  const w = (a.wins ?? 0) - (b.wins ?? 0);
  if (w !== 0) return w;
  // 3) Wurfzahl (DESC)
  return (b.roll ?? 0) - (a.roll ?? 0);
}

function rollInt(max) {
  return 1 + Math.floor(Math.random() * max); // 1..max
}

function reasonEmoji(reason) {
  return reason === "gear" ? "⚔️" : reason === "trait" ? "💠" : "📜";
}

function formatLine(entry, rankIdx) {
  const medal = rankIdx === 0 ? "🥇" : rankIdx === 1 ? "🥈" : rankIdx === 2 ? "🥉" : "-";
  const prettyReason = entry.reason[0].toUpperCase() + entry.reason.slice(1);
  return `${medal} <@${entry.user_id}> · ${reasonEmoji(entry.reason)} ${prettyReason} · (W${entry.win_count_after ?? entry.wins ?? 0}) · Wurf ${entry.roll}`;
}

export default {
  idStartsWith: "roll:select",

  run: async (ctx) => {
    try {
      if (!hasModPerm(ctx)) {
        return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
      }

      const guildId = ctx.guildId;
      const itemSlug = ctx.values?.[0];
      if (!itemSlug) {
        return ctx.reply("⚠️ Ungültige Auswahl.", { ephemeral: true });
      }

      // Item-Name ermitteln (48h)
      const nameRows = await ctx.db.query(
        `
        SELECT MIN(v.item_name_first) AS item_name
        FROM votes v
        WHERE v.guild_id = $1
          AND v.item_slug = $2
          AND v.created_at > NOW() - INTERVAL '48 hours'
        `,
        [guildId, itemSlug]
      );
      const itemName = nameRows?.[0]?.item_name || itemSlug;

      // Teilnehmer laden:
      // 1. Versuch: mit wins-Join (letzte 48h)
      // 2. Fallback (42P01 = undefined_table): ohne wins → wins = 0
      let participants;
      try {
        participants = await ctx.db.query(
          `
          WITH latest AS (
            SELECT DISTINCT ON (user_id)
              user_id, reason, created_at
            FROM votes
            WHERE guild_id = $1
              AND item_slug = $2
              AND created_at > NOW() - INTERVAL '48 hours'
            ORDER BY user_id, created_at DESC
          ),
          wins48 AS (
            SELECT winner_user_id AS user_id, COUNT(*)::int AS wins
            FROM wins
            WHERE guild_id = $1
              AND item_slug = $2
              AND rolled_at > NOW() - INTERVAL '48 hours'
            GROUP BY winner_user_id
          )
          SELECT
            l.user_id,
            l.reason,                     -- gear|trait|litho
            COALESCE(w.wins, 0)::int AS wins
          FROM latest l
          LEFT JOIN wins48 w USING (user_id)
          ORDER BY l.user_id ASC
          `,
          [guildId, itemSlug]
        );
      } catch (e) {
        if (e && (e.code === "42P01" || String(e.message || "").includes("relation \"wins\""))) {
          // Fallback ohne wins
          participants = await ctx.db.query(
            `
            WITH latest AS (
              SELECT DISTINCT ON (user_id)
                user_id, reason, created_at
              FROM votes
              WHERE guild_id = $1
                AND item_slug = $2
                AND created_at > NOW() - INTERVAL '48 hours'
              ORDER BY user_id, created_at DESC
            )
            SELECT
              l.user_id,
              l.reason,
              0::int AS wins
            FROM latest l
            ORDER BY l.user_id ASC
            `,
            [guildId, itemSlug]
          );
        } else {
          throw e; // anderer Fehler → normal behandeln
        }
      }

      if (!participants?.length) {
        return ctx.reply(`ℹ️ Keine qualifizierten Teilnehmer für **${itemName}** in den letzten 48h.`, { ephemeral: false });
      }

      // Erster Wurf für alle (W20)
      let rolled = participants.map(p => ({ ...p, roll: rollInt(20) }));

      // Für Anzeige sortieren
      rolled.sort(cmpDisplay);

      // Top-Gruppe (alle, die Platz 1 teilen)
      const top = rolled.filter(e => cmpDisplay(e, rolled[0]) === 0);

      // Voller Gleichstand? (Grund + Wins + Roll)
      const isFullTie = (group) => {
        if (group.length < 2) return false;
        const a = group[0];
        return group.every(x =>
          (PRIO[x.reason] ?? 0) === (PRIO[a.reason] ?? 0) &&
          (x.wins ?? 0) === (a.wins ?? 0) &&
          (x.roll ?? 0) === (a.roll ?? 0)
        );
      };

      let winner = top[0];
      if (isFullTie(top)) {
        // Sudden-Death nur unter Gleichauf-Teilnehmern
        let pool = top.map(x => ({ ...x }));
        for (let i = 0; i < 10; i++) { // Sicherheitsgrenze
          pool = pool.map(x => ({ ...x, roll: rollInt(20) }));
          pool.sort(cmpDisplay);
          const group = pool.filter(e => cmpDisplay(e, pool[0]) === 0);
          if (!isFullTie(group)) {
            winner = pool[0];
            break;
          }
        }
        winner._tieBreak = true;
      }

      // Gewinner speichern (falls wins existiert). Bei Fehler → trotzdem Anzeige.
      let stored = false;
      let winnerWinCount = (winner.wins ?? 0) + 1;

      try {
        const insRows = await ctx.db.query(
          `
          WITH prev AS (
            SELECT COALESCE(MAX(win_count), 0)::int AS prev_count
            FROM wins
            WHERE guild_id = $1 AND item_slug = $2 AND winner_user_id = $3
          ),
          ins AS (
            INSERT INTO wins (guild_id, item_slug, item_name_first, winner_user_id, reason, rolled_at, roll_value, win_count)
            SELECT $1, $2, $3, $4, $5, NOW(), $6, (SELECT prev_count FROM prev) + 1
            RETURNING win_count
          )
          SELECT win_count FROM ins
          `,
          [guildId, itemSlug, itemName, winner.user_id, winner.reason, winner.roll]
        );
        if (insRows?.[0]?.win_count != null) {
          winnerWinCount = insRows[0].win_count;
          stored = true;
        }
      } catch (_) {
        // wins existiert noch nicht o.ä. → egal, Anzeige bleibt transparent
      }

      // Anzeige-Liste final (Gewinner erhält neuen Count)
      const display = rolled.map(e => ({
        ...e,
        win_count_after: e.user_id === winner.user_id ? winnerWinCount : e.wins
      })).sort(cmpDisplay);

      const header = `🎲 Roll-Ergebnis für **${itemName}**${winner._tieBreak ? " (Tie-Break)" : ""}:`;
      const lines = display.map((e, i) => formatLine(e, i));
      const footer =
        `\n\n🏆 Gewinner: <@${winner.user_id}> — ${reasonEmoji(winner.reason)} ${winner.reason[0].toUpperCase() + winner.reason.slice(1)} · Wurf ${winner.roll} · (W${winnerWinCount})` +
        (stored ? "" : "  ⚠️ (nicht gespeichert)");
      const tieNote = winner._tieBreak ? `\n↪️ Tie-Break nur zwischen Gleichauf-Teilnehmern durchgeführt.` : "";

      return ctx.reply(`${header}\n${lines.join("\n")}${footer}${tieNote}`, { ephemeral: false });
    } catch (e) {
      console.error("[components/roll-select] error:", e);
      return ctx.reply("⚠️ Unerwarteter Fehler beim Roll.", { ephemeral: true });
    }
  },
};
