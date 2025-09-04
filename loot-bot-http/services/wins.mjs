// services/wins.mjs
// DB-Layer für persistente Wins (Railway Postgres).
// ENV: DATABASE_URL (postgres://...)
// ESM: "type": "module"

import { Pool } from "pg";

let _pool = null;
function pool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL fehlt (ENV).");
  }
  _pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Railway/Neon kompatibel
    max: 5,
  });
  return _pool;
}

// -- Schema & Bootstrap -------------------------------------------------------

export async function ensureSchema() {
  const sql = `
    CREATE TABLE IF NOT EXISTS wins (
      guild_id TEXT NOT NULL,
      item_slug TEXT NOT NULL,
      item_name_first TEXT NOT NULL,
      winner_user_id TEXT NOT NULL,
      reason TEXT,                      -- 'gear' | 'trait' | 'litho'
      rolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      roll_value INT,
      win_count INT DEFAULT 1,
      PRIMARY KEY (guild_id, item_slug, winner_user_id)
    );

    -- Optional: schnelle Filter auf Gilde/Item und Zeit
    CREATE INDEX IF NOT EXISTS wins_guild_time_idx
      ON wins (guild_id, rolled_at DESC);

    CREATE INDEX IF NOT EXISTS wins_guild_item_idx
      ON wins (guild_id, item_slug);
  `;
  await pool().query(sql);
}

// -- Utils --------------------------------------------------------------------

function normalizeReason(reason) {
  if (!reason) return null;
  const r = String(reason).toLowerCase().trim();
  if (r === "gear" || r === "trait" || r === "litho") return r;
  return null;
}

function toInt(x, def = null) {
  const n = Number.parseInt(x, 10);
  return Number.isFinite(n) ? n : def;
}

// -- Core API -----------------------------------------------------------------

/**
 * Insert oder Increment bei erneutem Gewinn des gleichen Users für dasselbe Item.
 * - Aktualisiert rolled_at, roll_value, reason (letzter Stand)
 * - Erhöht win_count (default +1)
 */
export async function insertWin({
  guildId,
  itemSlug,
  itemNameFirst,
  winnerUserId,
  reason,
  rollValue,
  incrementBy = 1,
}) {
  if (!guildId || !itemSlug || !itemNameFirst || !winnerUserId) {
    throw new Error("insertWin: guildId, itemSlug, itemNameFirst, winnerUserId erforderlich.");
  }

  const r = normalizeReason(reason);
  const rv = toInt(rollValue);

  const sql = `
    INSERT INTO wins (guild_id, item_slug, item_name_first, winner_user_id, reason, roll_value, win_count)
    VALUES ($1, $2, $3, $4, $5, $6, GREATEST($7, 1))
    ON CONFLICT (guild_id, item_slug, winner_user_id)
    DO UPDATE SET
      win_count  = wins.win_count + GREATEST(EXCLUDED.win_count, 1),
      reason     = COALESCE(EXCLUDED.reason, wins.reason),
      roll_value = COALESCE(EXCLUDED.roll_value, wins.roll_value),
      rolled_at  = NOW(),
      item_name_first = EXCLUDED.item_name_first
    RETURNING guild_id, item_slug, item_name_first, winner_user_id, reason, roll_value, win_count, rolled_at;
  `;

  const vals = [guildId, itemSlug, itemNameFirst, winnerUserId, r, rv, toInt(incrementBy, 1)];
  const { rows } = await pool().query(sql, vals);
  return rows[0];
}

/**
 * Win-Count manuell erhöhen (z. B. für Backfill oder Sonderfälle).
 */
export async function incrementWin({ guildId, itemSlug, winnerUserId, step = 1 }) {
  if (!guildId || !itemSlug || !winnerUserId) {
    throw new Error("incrementWin: guildId, itemSlug, winnerUserId erforderlich.");
  }
  const sql = `
    UPDATE wins
       SET win_count = win_count + GREATEST($4, 1),
           rolled_at = NOW()
     WHERE guild_id = $1 AND item_slug = $2 AND winner_user_id = $3
     RETURNING guild_id, item_slug, winner_user_id, win_count, rolled_at;
  `;
  const { rows } = await pool().query(sql, [guildId, itemSlug, winnerUserId, toInt(step, 1)]);
  return rows[0] ?? null;
}

/**
 * Win-Count reduzieren (für /reducew). Fällt nie unter 0.
 */
export async function decrementWin({ guildId, itemSlug, winnerUserId, step = 1 }) {
  if (!guildId || !itemSlug || !winnerUserId) {
    throw new Error("decrementWin: guildId, itemSlug, winnerUserId erforderlich.");
  }
  const sql = `
    UPDATE wins
       SET win_count = GREATEST(win_count - GREATEST($4, 1), 0),
           rolled_at = NOW()
     WHERE guild_id = $1 AND item_slug = $2 AND winner_user_id = $3
     RETURNING guild_id, item_slug, winner_user_id, win_count, rolled_at;
  `;
  const { rows } = await pool().query(sql, [guildId, itemSlug, winnerUserId, toInt(step, 1)]);
  return rows[0] ?? null;
}

/**
 * Letzte Wins seit X Stunden (Default 48h) – optional gefiltert auf Item.
 * Nützlich für winner-Ausgaben und Reroll-Quelle.
 */
export async function getRecentWins({ guildId, sinceHours = 48, itemSlug = null }) {
  if (!guildId) throw new Error("getRecentWins: guildId erforderlich.");
  const hours = Math.max(1, toInt(sinceHours, 48));
  const base = `
    SELECT guild_id, item_slug, item_name_first, winner_user_id, reason, roll_value, win_count, rolled_at
      FROM wins
     WHERE guild_id = $1
       AND rolled_at >= NOW() - ($2::text || ' hours')::interval
  `;
  const sql = itemSlug ? base + " AND item_slug = $3 ORDER BY rolled_at DESC" : base + " ORDER BY rolled_at DESC";
  const vals = itemSlug ? [guildId, String(hours), itemSlug] : [guildId, String(hours)];
  const { rows } = await pool().query(sql, vals);
  return rows;
}

/**
 * DISTINCT Item-Liste aus Wins der letzten X Stunden – für reroll-select.
 */
export async function getDistinctItemsFromWins({ guildId, sinceHours = 48 }) {
  if (!guildId) throw new Error("getDistinctItemsFromWins: guildId erforderlich.");
  const hours = Math.max(1, toInt(sinceHours, 48));
  const sql = `
    SELECT DISTINCT item_slug, MAX(item_name_first) AS item_name_first
      FROM wins
     WHERE guild_id = $1
       AND rolled_at >= NOW() - ($2::text || ' hours')::interval
  GROUP BY item_slug
  ORDER BY item_slug;
  `;
  const { rows } = await pool().query(sql, [guildId, String(hours)]);
  return rows.map(r => ({ itemSlug: r.item_slug, itemNameFirst: r.item_name_first }));
}

/**
 * Win-Zähler je User für ein Item (gesamt, nicht zeitlich begrenzt) – für Comparator.
 * Liefert Map userId -> win_count.
 */
export async function getUserWinsForItem({ guildId, itemSlug }) {
  if (!guildId || !itemSlug) throw new Error("getUserWinsForItem: guildId, itemSlug erforderlich.");
  const sql = `
    SELECT winner_user_id, win_count
      FROM wins
     WHERE guild_id = $1 AND item_slug = $2;
  `;
  const { rows } = await pool().query(sql, [guildId, itemSlug]);
  const map = new Map();
  for (const r of rows) map.set(r.winner_user_id, toInt(r.win_count, 0));
  return map;
}

/**
 * (Optional) Für Aufräum-/Adminzwecke: Wins eines Items löschen.
 */
export async function deleteItemWins({ guildId, itemSlug }) {
  if (!guildId || !itemSlug) throw new Error("deleteItemWins: guildId, itemSlug erforderlich.");
  const sql = `DELETE FROM wins WHERE guild_id = $1 AND item_slug = $2;`;
  const res = await pool().query(sql, [guildId, itemSlug]);
  return { deleted: res.rowCount ?? 0 };
}
