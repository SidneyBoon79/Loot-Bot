// commands/roll.mjs
// Rollt Gewinner für ein Item anhand der letzten 48h Votes aus der DB
// Fairness: Gear > Trait > Litho  →  Wins ASC  →  Wurf DESC
// ESM: "type": "module"

import { Pool } from "pg";
import {
  insertWin,
  getUserWinsForItem,
} from "../services/wins.mjs"; // Pfad anpassen

// ---- DB Helper (Votes lesen) ------------------------------------------------
let _pool = null;
function pool() {
  if (_pool) return _pool;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL fehlt (ENV).");
  _pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false }, max: 5 });
  return _pool;
}

// Votes der letzten 48h für ein Item (gleiches Fenster wie vote-show)
async function getVotesForItem({ guildId, itemSlug, hours = 48 }) {
  const sql = `
    SELECT user_id, reason -- reason: 'gear'|'trait'|'litho'
      FROM votes
     WHERE guild_id = $1
       AND item_slug = $2
       AND created_at >= NOW() - ($3::text || ' hours')::interval
  `;
  const { rows } = await pool().query(sql, [guildId, itemSlug, String(hours)]);
  return rows.map(r => ({ userId: r.user_id, reason: (r.reason || "").toLowerCase() }));
}

// ---- Fairness Comparator ----------------------------------------------------
const PRIO = { gear: 2, trait: 1, litho: 0 };

function cmp(a, b) {
  // 1) Grund-Priorität: Gear > Trait > Litho
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0);
  if (g !== 0) return g;
  // 2) Weniger Wins zuerst (ASC)
  const w = (a.wins ?? 0) - (b.wins ?? 0);
  if (w !== 0) return w;
  // 3) Höherer Wurf gewinnt (DESC)
  return (b.roll ?? 0) - (a.roll ?? 0);
}

// ---- Utils ------------------------------------------------------------------
function d100() {
  return Math.floor(Math.random() * 100) + 1;
}

function formatRanking(cands, winner) {
  const lines = [];
  cands.forEach((c, i) => {
    const prefix = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "-";
    lines.push(
      `${prefix} <@${c.userId}> — ${c.roll} (W${c.wins ?? 0}, ${c.reason || "?"})`
    );
  });
  const winLine =
    `\n🏆 **Gewinner:** <@${winner.userId}> — Grund: **${winner.reason || "?"}**, ` +
    `Wurf: **${winner.roll}**, neuer Count: **W${winner.newWinCount}**`;
  return lines.join("\n") + winLine;
}

// ---- Command Handler --------------------------------------------------------
// Erwartet ctx mit: guildId, reply(text), options: { itemSlug, itemNameFirst }
// Wenn kein itemSlug übergeben wurde, sollte dein Router roll-select öffnen (separat).
export default async function handleRoll(ctx) {
  const guildId = ctx.guildId || ctx.guild_id || ctx.guild?.id;
  const itemSlug = ctx.options?.itemSlug || ctx.itemSlug || ctx.values?.itemSlug;
  const itemNameFirst = ctx.options?.itemNameFirst || ctx.itemNameFirst || ctx.values?.itemNameFirst || itemSlug;

  if (!guildId) return ctx.reply?.({ content: "Kein Guild-Kontext.", ephemeral: true });
  if (!itemSlug) {
    // Kein Item übergeben → UI-Komponente (roll-select) soll greifen
    return ctx.reply?.({ content: "Wähle ein Item im Dropdown (roll-select).", ephemeral: true });
  }

  // 1) Votes der letzten 48h laden
  const votes = await getVotesForItem({ guildId, itemSlug, hours: 48 });
  if (!votes.length) {
    return ctx.reply?.({ content: `Keine Votes (48h) für **${itemNameFirst}**.`, ephemeral: true });
  }

  // 2) Wins-Map laden (gesamt, itembezogen) für Fairness
  const winsMap = await getUserWinsForItem({ guildId, itemSlug });

  // 3) Kandidaten rollen
  const candidates = votes.map(v => ({
    userId: v.userId,
    reason: v.reason === "gear" ? "gear" : v.reason === "trait" ? "trait" : "litho",
    wins: winsMap.get(v.userId) ?? 0,
    roll: d100(),
  }));

  // 4) Sortieren nach Fairness
  candidates.sort(cmp);

  // 5) Gewinner persistieren
  const winner = candidates[0];
  const persisted = await insertWin({
    guildId,
    itemSlug,
    itemNameFirst,
    winnerUserId: winner.userId,
    reason: winner.reason,
    rollValue: winner.roll,
  });

  // 6) Antwort bauen
  const replyText =
    `**🎲 Roll für:** ${itemNameFirst}\n` +
    formatRanking(candidates, { ...winner, newWinCount: persisted?.win_count ?? (winner.wins + 1) });

  return ctx.reply?.({ content: replyText });
}
