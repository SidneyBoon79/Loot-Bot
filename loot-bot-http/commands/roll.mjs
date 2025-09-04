// commands/roll.mjs
// Rollt Gewinner für ein Item anhand der letzten 48h Votes aus der DB.
// Wenn kein Item übergeben wurde, sendet der Command ein Dropdown (roll-select).
// Fairness: Gear > Trait > Litho  →  Wins ASC  →  Wurf DESC
// ESM: "type": "module"

import { Pool } from "pg";
import { insertWin, getUserWinsForItem } from "../services/wins.mjs"; // Pfad ggf. anpassen

// ---- DB Helper --------------------------------------------------------------
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
  const { rows } = await pool().query(sql, [guildId, itemSlug, String(hours)]);
  return rows.map(r => ({ userId: r.user_id, reason: (r.reason || "").toLowerCase() }));
}

// Items mit Votes (48h) für das Dropdown
async function getItemsWithVotes({ guildId, hours = 48, limit = 25 }) {
  const sql = `
    SELECT item_slug, MAX(item_name_first) AS item_name_first, COUNT(*) AS cnt
      FROM votes
     WHERE guild_id = $1
       AND created_at >= NOW() - ($2::text || ' hours')::interval
  GROUP BY item_slug
  ORDER BY cnt DESC, item_slug
  LIMIT $3
  `;
  const { rows } = await pool().query(sql, [guildId, String(hours), limit]);
  return rows.map(r => ({ itemSlug: r.item_slug, itemNameFirst: r.item_name_first || r.item_slug }));
}

// ---- Fairness Comparator ----------------------------------------------------
const PRIO = { gear: 2, trait: 1, litho: 0 };
function cmp(a, b) {
  const g = (PRIO[b.reason] ?? 0) - (PRIO[a.reason] ?? 0); // 1) Gear > Trait > Litho
  if (g !== 0) return g;
  const w = (a.wins ?? 0) - (b.wins ?? 0);                 // 2) weniger Wins zuerst
  if (w !== 0) return w;
  return (b.roll ?? 0) - (a.roll ?? 0);                    // 3) höherer Wurf gewinnt
}

// ---- Utils ------------------------------------------------------------------
function d100() { return Math.floor(Math.random() * 100) + 1; }

function formatRanking(cands, winner, itemNameFirst) {
  const lines = cands.map((c, i) => {
    const p = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "-";
    return `${p} <@${c.userId}> — ${c.roll} (W${c.wins ?? 0}, ${c.reason || "?"})`;
  });
  const winLine =
    `\n🏆 **Gewinner:** <@${winner.userId}> — Grund: **${winner.reason || "?"}**, ` +
    `Wurf: **${winner.roll}**, neuer Count: **W${winner.newWinCount}**`;
  return `**🎲 Roll für:** ${itemNameFirst}\n` + lines.join("\n") + winLine;
}

// ---- Command-Logic ----------------------------------------------------------
export async function run(ctx) {
  const guildId = ctx.guildId || ctx.guild_id || ctx.guild?.id;
  const itemSlug = ctx.options?.itemSlug || ctx.itemSlug || ctx.values?.itemSlug;
  const itemNameFirst =
    ctx.options?.itemNameFirst || ctx.itemNameFirst || ctx.values?.itemNameFirst || itemSlug;

  if (!guildId) return ctx.reply?.({ content: "Kein Guild-Kontext.", ephemeral: true });

  // Kein Item übergeben → Dropdown anzeigen
  if (!itemSlug) {
    const items = await getItemsWithVotes({ guildId, hours: 48, limit: 25 });
    if (!items.length) {
      return ctx.reply?.({ content: "Keine Items mit Votes in den letzten 48h.", ephemeral: true });
    }
    const options = items.map(it => ({
      label: it.itemNameFirst.slice(0, 100),
      value: JSON.stringify({ itemSlug: it.itemSlug, itemNameFirst: it.itemNameFirst }).slice(0, 100), // Discord limit
      description: it.itemSlug.slice(0, 100),
    }));
    return ctx.reply?.({
      content: "Wähle ein Item:",
      components: [
        {
          type: 1, // action row
          components: [
            {
              type: 3, // string select
              custom_id: "roll-select",
              placeholder: "Item auswählen…",
              min_values: 1,
              max_values: 1,
              options
            }
          ]
        }
      ],
      ephemeral: true,
    });
  }

  // Mit Item: Votes laden
  const votes = await getVotesForItem({ guildId, itemSlug, hours: 48 });
  if (!votes.length) {
    return ctx.reply?.({ content: `Keine Votes (48h) für **${itemNameFirst}**.`, ephemeral: true });
  }

  // Wins-Map (gesamt, itembezogen) für Fairness
  const winsMap = await getUserWinsForItem({ guildId, itemSlug });

  // Kandidaten würfeln
  const candidates = votes.map(v => ({
    userId: v.userId,
    reason: v.reason === "gear" ? "gear" : v.reason === "trait" ? "trait" : "litho",
    wins: winsMap.get(v.userId) ?? 0,
    roll: d100(),
  })).sort(cmp);

  // Gewinner persistieren
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
    { ...top, newWinCount: persisted?.win_count ?? (top.wins + 1) },
    itemNameFirst
  );
  return ctx.reply?.({ content: replyText });
}

// ---- Exporte für unterschiedliche Router-Stile ------------------------------
export const roll = { run };
export default roll;
