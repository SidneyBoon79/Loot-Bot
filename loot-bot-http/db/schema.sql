-- db/schema.sql
-- Postgres-Schema für Loot-Bot

-- =========================
-- 1) votes
-- =========================
CREATE TABLE IF NOT EXISTS votes (
  guild_id         TEXT        NOT NULL,
  user_id          TEXT        NOT NULL,
  item_slug        TEXT        NOT NULL,
  type             TEXT        NOT NULL CHECK (type IN ('gear','trait','litho')),
  reason           TEXT        NOT NULL,                      -- = type (NOT NULL-Constraint aus deinem Projekt)
  item_name_first  TEXT        NOT NULL,                      -- hübscher Displayname
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT votes_unique_per_user_item UNIQUE (guild_id, user_id, item_slug)
);

-- Schnelle Filter für 48h-Fenster & Lookups
CREATE INDEX IF NOT EXISTS votes_guild_item_idx   ON votes (guild_id, item_slug);
CREATE INDEX IF NOT EXISTS votes_guild_created_ix ON votes (guild_id, created_at DESC);


-- =========================
-- 2) items
-- =========================
CREATE TABLE IF NOT EXISTS items (
  guild_id         TEXT        NOT NULL,
  item_slug        TEXT        NOT NULL,
  item_name_first  TEXT        NOT NULL,
  rolled_at        TIMESTAMPTZ NULL,
  rolled_by        TEXT        NULL,          -- Gewinner-User-ID (für Re-Roll-Umbuchung)
  rolled_manual    BOOLEAN     NOT NULL DEFAULT FALSE,

  CONSTRAINT items_pk PRIMARY KEY (guild_id, item_slug)
);

-- Für schnelle Abfragen nach Status
CREATE INDEX IF NOT EXISTS items_guild_rolledat_idx ON items (guild_id, rolled_at);


-- =========================
-- 3) wins
-- =========================
CREATE TABLE IF NOT EXISTS wins (
  guild_id   TEXT        NOT NULL,
  user_id    TEXT        NOT NULL,
  win_count  INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT wins_pk PRIMARY KEY (guild_id, user_id)
);

-- Für Leaderboards / Abfragen
CREATE INDEX IF NOT EXISTS wins_guild_updated_idx ON wins (guild_id, updated_at DESC);


-- =========================
-- 4) members (optional Cache)
-- =========================
CREATE TABLE IF NOT EXISTS members (
  guild_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT members_pk PRIMARY KEY (guild_id, user_id)
);

-- =========================
-- 5) nützliche Views (optional)
-- =========================

-- Items mit aktiven Votes im 48h-Fenster
CREATE OR REPLACE VIEW v_items_active_48h AS
SELECT i.guild_id, i.item_slug, i.item_name_first, i.rolled_at
FROM items i
WHERE EXISTS (
  SELECT 1 FROM votes v
  WHERE v.guild_id = i.guild_id
    AND v.item_slug = i.item_slug
    AND v.created_at > NOW() - INTERVAL '48 hours'
);

-- =========================
-- 6) Hinweise
-- =========================
-- - Die UNIQUE-Constraint in votes verhindert Doppelvotes pro (guild_id, user_id, item_slug).
-- - items.rolled_by speichert den Gewinner-User (wichtig für /reroll Umbuchung).
-- - Prüfe, ob deine DB-URL/Pool korrekt gesetzt ist (z. B. DATABASE_URL).
