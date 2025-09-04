// commands/roll.mjs
// Rollt Gewinner für ein Item anhand der letzten 48h Votes aus der DB
// Fairness: Gear > Trait > Litho  →  Wins ASC  →  Wurf DESC
// ESM: "type": "module"

import { Pool } from "pg";
import { insertWin, getUserWinsForItem } from "../services/wins.mjs"; // Pfad ggf. anpassen

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
    SELECT user_id, reason -- 'gear'|'trait'|'litho'
      FROM votes
     WHERE guild_id = $1
       AND item_slug = $2
       AND created_at >= NOW() - ($3::text || ' hours')::interval
  `;
  const { rows } = await pool().query([sql, [guildId, itemSlug, String(hours)]].flat());
  return rows.map(r => ({ userId: r.user_id, reason: (r.reason || "").toLowerCase() }));
}

// ---- Fairness Comparator ----------------------------------------------------
const PRIO = { gear: 2, trait: 1, litho: 0 };
function cmp(a, b) {
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0);
  if (g !== 0) return g;                          // 1) Gear > Trait > Litho
  const w = (a.wins ?? 0) - (b.wins ?? 0);
  if (w !== 0) return w;                          // 2) weniger Wins zuerst
  return (b.roll ?? 0) - (a.roll ?? 0);           // 3) höherer Wurf gewinnt
}

// ---- Utils ------------------------------------------------------------------
function d100() { return Math.floor(Math.random() * 100) + 1; }
function formatRanking(cands, winner) {
  const lines = cands.map((c, i) => {
    const p = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "-";
    return `${p} <@${c.userId}> — ${c.roll} (W${c.wins ?? 0}, ${c.reason || "?"})`;
  });
  const winLine =
    `\n🏆 **Gewinner:** <@${winner.userId}> — Grund: **${winner.reason || "?"}**, ` +
    `Wurf: **${winner.roll}**, neuer Count: **W${winner.newWinCount}**`;
  return `**🎲 Roll für:** ${winner.itemNameFirst}\n` + lines.join("\n") + winLine;
}

// ---- Command-Logic ----------------------------------------------------------
export async function run(ctx) {
  const guildId = ctx.guildId || ctx.guild_id || ctx.guild?.id;
  const itemSlug = ctx.options?.itemSlug || ctx.itemSlug || ctx.values?.itemSlug;
  const itemNameFirst =
    ctx.options?.itemNameFirst || ctx.itemNameFirst || ctx.values?.itemNameFirst || itemSlug;

  if (!guildId) return ctx.reply?.({ content: "Kein Guild-Kontext.", ephemeral: true });
  if (!itemSlug) return ctx.reply?.({ content: "Wähle ein Item im Dropdown (roll-select).", ephemeral: true });

  const votes = await getVotesForItem({ guildId, itemSlug, hours: 48 });
  if (!votes.length) {
    return ctx.reply?.({ content: `Keine Votes (48h) für **${itemNameFirst}**.`, ephemeral: true });
  }

  const winsMap = await getUserWinsForItem({ guildId, itemSlug });

  const candidates = votes.map(v => ({
    userId: v.userId,
    reason: v.reason === "gear" ? "gear" : v.reason === "trait" ? "trait" : "litho",
    wins: winsMap.get(v.userId) ?? 0,
    roll: d100(),
  })).sort(cmp);

  const top = candidates[0];
  const persisted = await insertWin({
    guildId,
    itemSlug,
    itemNameFirst,
    winnerUserId: top.userId,
    reason: top.reason,
    rollValue: top.roll,
  });

  const replyText = formatRanking(
    candidates,
    { ...top, newWinCount: persisted?.win_count ?? (top.wins + 1), itemNameFirst }
  );
  return ctx.reply?.({ content: replyText });
}

// ---- Exporte für unterschiedliche Router-Stile ------------------------------
// 1) Named-Objekt: import { roll } from "./roll.mjs"; → roll.run(ctx)
export const roll = { run };
// 2) Default-Objekt: import roll from "./roll.mjs"; → roll.run(ctx)
export default roll;
// 3) Optionaler direkter Named-Export: import { run } from "./roll.mjs"; → run(ctx)
//    (bereits oben exportiert)
