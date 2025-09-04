// services/wins.mjs
// DB-Layer für persistente Wins (Railway Postgres) – kompatibel zu Legacy-Schema.
// Erkennt zur Laufzeit, ob 'user_id' existiert, und schreibt/liest entsprechend.
// ESM: "type": "module"

import { Pool } from "pg";

let _pool = null;
function pool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL fehlt (ENV).");
  _pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  return _pool;
}

// Merker, ob Legacy-Spalte 'user_id' existiert (und wir sie bedienen müssen)
let HAS_USER_ID_COL = false;

/**
 * Schema-Setup (idempotent, ohne Primärschlüssel zu verändern):
 * - Tabelle wins anlegen, falls sie fehlt
 * - fehlende Spalten ergänzen
 * - winner_user_id aus user_id füllen (falls vorhanden & leer)
 * - Indizes setzen
 * - HAS_USER_ID_COL bestimmen (steuert Lese-/Schreibpfad)
 */
export async function ensureSchema() {
  // 1) Grundgerüst & Spalten
  const sql = `
  BEGIN;

  CREATE TABLE IF NOT EXISTS wins (
    guild_id TEXT NOT NULL,
    item_slug TEXT NOT NULL,
    item_name_first TEXT NOT NULL,
    winner_user_id TEXT NOT NULL,
    reason TEXT,
    rolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    roll_value INT,
    win_count INT DEFAULT 1
  );

  ALTER TABLE wins ADD COLUMN IF NOT EXISTS guild_id TEXT;
  ALTER TABLE wins ADD COLUMN IF NOT EXISTS item_slug TEXT;
  ALTER TABLE wins ADD COLUMN IF NOT EXISTS item_name_first TEXT;
  ALTER TABLE wins ADD COLUMN IF NOT EXISTS winner_user_id TEXT;
  ALTER TABLE wins ADD COLUMN IF NOT EXISTS reason TEXT;
  ALTER TABLE wins ADD COLUMN IF NOT EXISTS rolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ALTER TABLE wins ADD COLUMN IF NOT EXISTS roll_value INT;
  ALTER TABLE wins ADD COLUMN IF NOT EXISTS win_count INT DEFAULT 1;

  -- winner_user_id aus user_id befüllen, wenn alt vorhanden
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'wins' AND column_name = 'user_id'
    ) THEN
      UPDATE wins
         SET winner_user_id = COALESCE(winner_user_id, user_id)
       WHERE winner_user_id IS NULL;
    END IF;
  END$$;

  -- Indizes (nur helfende Indizes, keinen PK anfassen)
  CREATE INDEX IF NOT EXISTS wins_guild_time_idx ON wins (guild_id, rolled_at);
  CREATE INDEX IF NOT EXISTS wins_guild_item_idx ON wins (guild_id, item_slug);
  CREATE UNIQUE INDEX IF NOT EXISTS wins_unique_idx ON wins (guild_id, item_slug, winner_user_id);

  COMMIT;
  `;
  await pool().query(sql);

  // 2) Schema-Feature-Check: gibt es 'user_id'?
  const { rows } = await pool().query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = 'wins' AND column_name = 'user_id'
     ) AS has_user_id`
  );
  HAS_USER_ID_COL = !!rows?.[0]?.has_user_id;
}

// Utils
function normalizeReason(reason) {
  if (!reason) return null;
  const r = String(reason).toLowerCase().trim();
  return r === "gear" || r === "trait" || r === "litho" ? r : null;
}
function toInt(x, def = null) {
  const n = Number.parseInt(x, 10);
  return Number.isFinite(n) ? n : def;
}

// Core API
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
  const inc = Math.max(1, toInt(incrementBy, 1));

  if (HAS_USER_ID_COL) {
    // Legacy-Pfad: auch in user_id schreiben, Konflikt auf (guild_id, item_slug, user_id)
    const sql = `
      INSERT INTO wins (guild_id, item_slug, item_name_first, winner_user_id, user_id, reason, roll_value, win_count)
      VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
      ON CONFLICT (guild_id, item_slug, user_id)
      DO UPDATE SET
        win_count  = wins.win_count + GREATEST(EXCLUDED.win_count, 1),
        reason     = COALESCE(EXCLUDED.reason, wins.reason),
        roll_value = COALESCE(EXCLUDED.roll_value, wins.roll_value),
        rolled_at  = NOW(),
        item_name_first = EXCLUDED.item_name_first
      RETURNING guild_id, item_slug, item_name_first, winner_user_id, reason, roll_value, win_count, rolled_at;
    `;
    const { rows } = await pool().query(sql, [guildId, itemSlug, itemNameFirst, winnerUserId, r, rv, inc]);
    return rows[0];
  } else {
    // Neues Schema: Konflikt auf (guild_id, item_slug, winner_user_id)
    const sql = `
      INSERT INTO wins (guild_id, item_slug, item_name_first, winner_user_id, reason, roll_value, win_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (guild_id, item_slug, winner_user_id)
      DO UPDATE SET
        win_count  = wins.win_count + GREATEST(EXCLUDED.win_count, 1),
        reason     = COALESCE(EXCLUDED.reason, wins.reason),
        roll_value = COALESCE(EXCLUDED.roll_value, wins.roll_value),
        rolled_at  = NOW(),
        item_name_first = EXCLUDED.item_name_first
      RETURNING guild_id, item_slug, item_name_first, winner_user_id, reason, roll_value, win_count, rolled_at;
    `;
    const { rows } = await pool().query(sql, [guildId, itemSlug, itemNameFirst, winnerUserId, r, rv, inc]);
    return rows[0];
  }
}

export async function incrementWin({ guildId, itemSlug, winnerUserId, step = 1 }) {
  if (!guildId || !itemSlug || !winnerUserId) {
    throw new Error("incrementWin: guildId, itemSlug, winnerUserId erforderlich.");
  }
  const sql = `
    UPDATE wins
       SET win_count = win_count + GREATEST($4, 1),
           rolled_at = NOW()
     WHERE guild_id = $1 AND item_slug = $2 AND (winner_user_id = $3 OR (SELECT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name = 'wins' AND column_name = 'user_id'
          )) AND user_id = $3)
     RETURNING guild_id, item_slug, winner_user_id, win_count, rolled_at;
  `;
  const { rows } = await pool().query(sql, [guildId, itemSlug, winnerUserId, Math.max(1, toInt(step, 1))]);
  return rows[0] ?? null;
}

export async function decrementWin({ guildId, itemSlug, winnerUserId, step = 1 }) {
  if (!guildId || !itemSlug || !winnerUserId) {
    throw new Error("decrementWin: guildId, itemSlug, winnerUserId erforderlich.");
  }
  const sql = `
    UPDATE wins
       SET win_count = GREATEST(win_count - GREATEST($4, 1), 0),
           rolled_at = NOW()
     WHERE guild_id = $1 AND item_slug = $2 AND (winner_user_id = $3 OR (SELECT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name = 'wins' AND column_name = 'user_id'
          )) AND user_id = $3)
     RETURNING guild_id, item_slug, winner_user_id, win_count, rolled_at;
  `;
  const { rows } = await pool().query(sql, [guildId, itemSlug, winnerUserId, Math.max(1, toInt(step, 1))]);
  return rows[0] ?? null;
}

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

export async function getUserWinsForItem({ guildId, itemSlug }) {
  if (!guildId || !itemSlug) throw new Error("getUserWinsForItem: guildId, itemSlug erforderlich.");

  let sql;
  if (HAS_USER_ID_COL) {
    // Legacy: user_id auswerten
    sql = `
      SELECT user_id AS id, win_count
        FROM wins
       WHERE guild_id = $1 AND item_slug = $2;
    `;
  } else {
    sql = `
      SELECT winner_user_id AS id, win_count
        FROM wins
       WHERE guild_id = $1 AND item_slug = $2;
    `;
  }
  const { rows } = await pool().query(sql, [guildId, itemSlug]);
  const map = new Map();
  for (const r of rows) map.set(r.id, toInt(r.win_count, 0));
  return map;
}

export async function deleteItemWins({ guildId, itemSlug }) {
  if (!guildId || !itemSlug) throw new Error("deleteItemWins: guildId, itemSlug erforderlich.");
  const sql = `DELETE FROM wins WHERE guild_id = $1 AND item_slug = $2;`;
  const res = await pool().query(sql, [guildId, itemSlug]);
  return { deleted: res.rowCount ?? 0 };
}
