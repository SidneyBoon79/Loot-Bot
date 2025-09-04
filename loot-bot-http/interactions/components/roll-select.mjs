// interactions/components/roll-select.mjs
// Nutzt dieselben Fallback-Prinzipien für den Item-Namen und für wins-Join wie besprochen.
// Sudden-Death bei vollständigem Gleichstand bleibt erhalten.

import { hasModPerm } from "../../services/permissions.mjs";

const PRIO = { gear: 2, trait: 1, litho: 0 };

function cmpDisplay(a, b) {
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0);
  if (g !== 0) return g;
  const w = (a.wins ?? 0) - (b.wins ?? 0);
  if (w !== 0) return w;
  return (b.roll ?? 0) - (a.roll ?? 0);
}

function rollInt(max) {
  return 1 + Math.floor(Math.random() * max);
}
function reasonEmoji(r) {
  return r === "gear" ? "⚔️" : r === "trait" ? "💠" : "📜";
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

      const guildId =
        ctx?.guildId ??
        ctx?.guild_id ??
        ctx?.interaction?.guild_id ??
        ctx?.guild?.id ??
        null;

      const itemSlug = ctx.values?.[0];
      if (!guildId || !itemSlug) {
        return ctx.reply("⚠️ Ungültige Auswahl.", { ephemeral: true });
      }

      // Item-Name mit Fallbacks bestimmen (item_name_first -> item_name -> slug)
      let itemName = null;
      const p = [String(guildId), itemSlug];

      try {
        const r1 = await ctx.db.query(
          `
          SELECT MIN(v.item_name_first) AS item_name
          FROM votes v
          WHERE v.guild_id = $1
            AND v.item_slug = $2
            AND v.created_at > NOW() - INTERVAL '48 hours'
          `,
          p
        );
        itemName = r1?.[0]?.item_name;
      } catch (_) {}

      if (!itemName) {
        try {
          const r2 = await ctx.db.query(
            `
            SELECT MIN(v.item_name) AS item_name
            FROM votes v
            WHERE v.guild_id = $1
              AND v.item_slug = $2
              AND v.created_at > NOW() - INTERVAL '48 hours'
            `,
            p
          );
          itemName = r2?.[0]?.item_name;
        } catch (_) {}
      }

      if (!itemName) itemName = itemSlug;

      // Teilnehmer mit wins-Join; Fallback, falls wins noch nicht existiert
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
            l.reason,
            COALESCE(w.wins, 0)::int AS wins
          FROM latest l
          LEFT JOIN wins48 w USING (user_id)
          ORDER BY l.user_id ASC
          `,
          p
        );
      } catch (e) {
        if (e && (e.code === "42P01" || String(e.message || "").includes("relation \"wins\""))) {
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
            p
          );
        } else {
          throw e;
        }
      }

      if (!participants?.length) {
        return ctx.reply(`ℹ️ Keine qualifizierten Teilnehmer für **${itemName}** in den letzten 48h.`, { ephemeral: false });
      }

      // Würfeln, sortieren, Sudden-Death
      let rolled = participants.map(p => ({ ...p, roll: rollInt(20) }));
      rolled.sort(cmpDisplay);
      const top = rolled.filter(e => cmpDisplay(e, rolled[0]) === 0);

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
        let pool = top.map(x => ({ ...x }));
        for (let i = 0; i < 10; i++) {
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

      // Gewinner speichern (non-blocking)
      let stored = false;
      let winnerWinCount = (winner.wins ?? 0) + 1;
      try {
        const ins = await ctx.db.query(
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
          [String(guildId), itemSlug, itemName, winner.user_id, winner.reason, winner.roll]
        );
        if (ins?.[0]?.win_count != null) {
          winnerWinCount = ins[0].win_count;
          stored = true;
        }
      } catch (_) {
        // Anzeige bleibt trotzdem transparent
      }

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
