// interactions/components/roll-select.mjs
// Drop-in, Roadmap-konform. Robust beim Auslesen der Select-Values.

import { hasModPerm as checkModPerm } from "../../services/permissions.mjs";

export const id = "roll-select";
export const idStartsWith = "roll-select";

const PRIO = { gear: 2, trait: 1, litho: 0 };

function normalizeSlug(x) {
  return String(x ?? "").trim().toLowerCase();
}

function reasonEmoji(r) {
  const k = (r ?? "").toLowerCase();
  if (k === "gear") return "🗡️";
  if (k === "trait") return "💠";
  if (k === "litho") return "📜";
  return "❔";
}

function medal(i) {
  return i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "–";
}

function rollInt(n = 20) {
  return Math.floor(Math.random() * n) + 1;
}

// Fairness Comparator: Gear > Trait > Litho → Wins (ASC) → Roll (DESC)
function cmpDisplay(a, b) {
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0);
  if (g !== 0) return g;
  const w = (a.wins ?? 0) - (b.wins ?? 0);
  if (w !== 0) return w;
  return (b.roll ?? 0) - (a.roll ?? 0);
}

function formatLine(e, i) {
  const r = reasonEmoji(e.reason);
  const win = typeof e.win_count_after === "number" ? ` (W${e.win_count_after})` : (typeof e.wins === "number" ? ` (W${e.wins})` : "");
  const roll = typeof e.roll === "number" ? ` · ${e.roll}` : "";
  return `${medal(i)} <@${e.user_id}> — ${r}${e.reason ? ` ${e.reason}` : ""}${roll}${win}`;
}

export async function run(ctx) {
  try {
    // Permissions
    if (!checkModPerm(ctx)) {
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

    // 🔧 Robust: Values aus beiden Pfaden akzeptieren
    const rawValues =
      ctx?.values ??
      ctx?.interaction?.data?.values ??
      [];
    const raw = rawValues[0];
    const itemSlug = normalizeSlug(raw);

    if (!itemSlug) {
      return ctx.reply("⚠️ Ungültige Auswahl.", { ephemeral: true });
    }

    // Item-Namen (48h) für hübsche Anzeige holen
    const { rows: nameRows } = await db.query(
      `
      SELECT MIN(v.item_name_first) AS name
      FROM votes v
      WHERE v.guild_id = $1
        AND v.item_slug = $2
        AND v.created_at > NOW() - INTERVAL '48 hours'
      `,
      [guildId, itemSlug]
    );
    const itemName = nameRows?.[0]?.name || itemSlug;

    // Teilnehmer (neuester Grund pro User im 48h-Fenster) + Wins im 48h-Fenster
    const { rows: participants } = await db.query(
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
        LOWER(l.reason) AS reason,
        COALESCE(w.wins, 0) AS wins
      FROM latest l
      LEFT JOIN wins48 w USING (user_id)
      `,
      [guildId, itemSlug]
    );

    if (!participants?.length) {
      return ctx.reply(`ℹ️ Keine qualifizierten Teilnehmer für **${itemName}** in den letzten 48h.`, { ephemeral: false });
    }

    // Würfeln + Sortierung
    let rolled = participants.map(p => ({ ...p, roll: rollInt(20) }));
    rolled.sort(cmpDisplay);

    // Prüfen, ob kompletter Gleichstand an der Spitze
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
      // Sudden-Death nur zwischen Gleichauf-Teilnehmern
      let pool = top.map(x => ({ ...x }));
      for (let i = 0; i < 10; i++) {
        pool = pool.map(x => ({ ...x, roll: rollInt(20) }));
        pool.sort(cmpDisplay);
        const group = pool.filter(e => cmpDisplay(e, pool[0]) === 0);
        if (!isFullTie(group)) {
          winner = pool[0];
          winner._tieBreak = true;
          break;
        }
      }
    }

    // Gewinner persistieren (insert/increment)
    let winnerWinCount = 1;
    let stored = false;
    try {
      const { rows: up } = await db.query(
        `
        INSERT INTO wins (guild_id, item_slug, item_name_first, winner_user_id, reason, roll_value, rolled_at, win_count)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), 1)
        ON CONFLICT (guild_id, item_slug, winner_user_id, rolled_at)
        DO UPDATE SET win_count = wins.win_count + 1
        RETURNING win_count
        `,
        [guildId, itemSlug, itemName, winner.user_id, winner.reason, winner.roll]
      );
      winnerWinCount = up?.[0]?.win_count ?? 1;
      stored = true;
    } catch {
      // Wenn die Tabelle/Constraint anders ist: nicht hart failen, nur Anzeige kennzeichnen.
      stored = false;
    }

    // Anzeige vorbereiten (W-Zähler beim Gewinner erhöhen)
    const display = rolled
      .map(e => ({ ...e, win_count_after: e.user_id === winner.user_id ? winnerWinCount : e.wins }))
      .sort(cmpDisplay);

    const header = `🎲 Roll-Ergebnis für **${itemName}**${winner._tieBreak ? " (Tie-Break)" : ""}:`;
    const lines = display.map((e, i) => formatLine(e, i));
    const footer =
      `\n\n🏆 Gewinner: <@${winner.user_id}> — ${reasonEmoji(winner.reason)} ${winner.reason?.slice(1) ?? ""} · Wurf ${winner.roll} · (W${winnerWinCount})` +
      (stored ? "" : "  ⚠️ (nicht gespeichert)");
    const tieNote = winner._tieBreak ? `\n↪️ Tie-Break nur zwischen Gleichauf-Teilnehmern durchgeführt.` : "";

    return ctx.reply(`${header}\n${lines.join("\n")}${footer}${tieNote}`, { ephemeral: false });
  } catch (e) {
    console.error("[components/roll-select] error:", e);
    return ctx.reply("⚠️ Unerwarteter Fehler beim Roll.", { ephemeral: true });
  }
}

export default { id, idStartsWith, run };
