// interactions/components/roll-select.mjs
import { query, one } from "../../services/db.mjs"; // one(sql, params) -> row|null
import { hasModPerm } from "../../services/permissions.mjs";

const PRIO = { gear: 2, trait: 1, litho: 0 };

// Hilfsfunktionen
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

function formatLine(entry, rankIdx) {
  const medal = rankIdx === 0 ? "🥇" : rankIdx === 1 ? "🥈" : rankIdx === 2 ? "🥉" : "-";
  const reasonEmoji = entry.reason === "gear" ? "⚔️" : entry.reason === "trait" ? "💠" : "📜";
  return `${medal} <@${entry.user_id}> · ${reasonEmoji} ${entry.reason[0].toUpperCase()}${entry.reason.slice(1)} · (W${entry.win_count_after ?? entry.wins ?? 0}) · Wurf ${entry.roll}`;
}

export default {
  // Der Router sollte anhand des Prefix "roll:select" hierher routen
  idStartsWith: "roll:select",

  run: async (ctx) => {
    if (!hasModPerm(ctx)) {
      return ctx.reply("❌ Keine Berechtigung.", { ephemeral: true });
    }

    const guildId = ctx.guildId;
    const itemSlug = ctx.values?.[0];
    if (!itemSlug) {
      return ctx.reply("⚠️ Ungültige Auswahl.", { ephemeral: true });
    }

    // 1) Item-Name + Teilnehmer (Votes 48h) laden
    const itemRow = await one(
      `
      SELECT MIN(v.item_name_first) AS item_name
      FROM votes v
      WHERE v.guild_id = $1 AND v.item_slug = $2
        AND v.created_at > NOW() - INTERVAL '48 hours'
      `,
      [guildId, itemSlug]
    );

    const itemName = itemRow?.item_name || itemSlug;

    const participants = await query(
      `
      -- Pro User maximal 1 Grund (neuster in 48h gewinnt die Kollision)
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

    if (!participants?.length) {
      return ctx.reply(`ℹ️ Keine qualifizierten Teilnehmer für **${itemName}** in den letzten 48h.`, { ephemeral: false });
    }

    // 2) Ersten Wurf für alle (für Anzeige & ggf. Tie-Break)
    let rolled = participants.map(p => ({ ...p, roll: rollInt(20) })); // W20; kannst du ändern (z. B. 100)

    // 3) Gewinner nach eurer festen Regel bestimmen mit Sudden-Death bei vollem Gleichstand
    const isFullTie = (group) => {
      if (group.length < 2) return false;
      const [a, ...rest] = group;
      return rest.every(x =>
        (PRIO[x.reason] ?? 0) === (PRIO[a.reason] ?? 0) &&
        (x.wins ?? 0) === (a.wins ?? 0) &&
        (x.roll ?? 0) === (a.roll ?? 0)
      );
    };

    // Sortiert für Anzeige
    rolled.sort(cmpDisplay);

    // Kandidaten mit höchstem Rang herausfiltern (alle, die Platz 1 teilen)
    const top = rolled.filter(e => cmpDisplay(e, rolled[0]) === 0);
    let winner = top[0];

    // Sudden-Death falls kompletter Gleichstand (Grund+Wins+Wurf identisch)
    if (isFullTie(top)) {
      // Nur diese erneut würfeln, bis eindeutig
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
      // Hinweis in der Ausgabe später
      winner._tieBreak = true;
    }

    // 4) Win persistieren & aktuellen Win-Count ermitteln
    //    Falls eure Tabelle noch nicht existiert, hier die SQL-Vorlage:
    //    CREATE TABLE IF NOT EXISTS wins(
    //      guild_id TEXT NOT NULL,
    //      item_slug TEXT NOT NULL,
    //      item_name_first TEXT NOT NULL,
    //      winner_user_id TEXT NOT NULL,
    //      reason TEXT,
    //      rolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    //      roll_value INT,
    //      win_count INT DEFAULT 1
    //    );

    let stored = false;
    let winnerWinCount = null;

    try {
      const ins = await one(
        `
        WITH prev AS (
          SELECT COALESCE(MAX(win_count), 0)::int AS prev_count
          FROM wins
          WHERE guild_id = $1 AND item_slug = $2 AND winner_user_id = $3
        ),
        ins AS (
          INSERT INTO wins (guild_id, item_slug, item_name_first, winner_user_id, reason, roll_value, win_count)
          SELECT $1, $2, $3, $4, $5, $6, (SELECT prev_count FROM prev) + 1
          RETURNING win_count
        )
        SELECT win_count FROM ins
        `,
        [guildId, itemSlug, itemName, winner.user_id, winner.reason, winner.roll]
      );
      stored = true;
      winnerWinCount = ins?.win_count ?? (winner.wins ?? 0) + 1;
    } catch {
      // Speichern fehlgeschlagen – wir zeigen dennoch transparent das Ergebnis an
      winnerWinCount = (winner.wins ?? 0) + 1;
    }

    // 5) Anzeige-Liste finalisieren (Wn für alle; Gewinner hat neuen Count)
    const withDisplayWins = rolled.map(e => {
      const isWinner = e.user_id === winner.user_id;
      return {
        ...e,
        win_count_after: isWinner ? winnerWinCount : e.wins
      };
    });

    // 6) Ausgabe-Text bauen
    const header = `🎲 Roll-Ergebnis für **${itemName}**${winner._tieBreak ? " (Tie-Break)" : ""}:`;
    const lines = withDisplayWins
      .sort(cmpDisplay)
      .map((e, i) => formatLine(e, i));

    const reasonEmoji = winner.reason === "gear" ? "⚔️" : winner.reason === "trait" ? "💠" : "📜";
    const footer = `\n\n🏆 Gewinner: <@${winner.user_id}> — ${reasonEmoji} ${winner.reason[0].toUpperCase()}${winner.reason.slice(1)} · Wurf ${winner.roll} · (W${winnerWinCount})${stored ? "" : "  ⚠️ (nicht gespeichert)"}`;

    const tieNote = winner._tieBreak
      ? `\n↪️ Tie-Break nur zwischen Gleichauf-Teilnehmern durchgeführt.`
      : "";

    return ctx.reply(`${header}\n${lines.join("\n")}${footer}${tieNote}`, { ephemeral: false });
  },
};
