-- wins.sql – idempotentes Schema für Roll-Gewinner

CREATE TABLE IF NOT EXISTS wins (
  guild_id        TEXT        NOT NULL,
  item_slug       TEXT        NOT NULL,
  item_name_first TEXT        NOT NULL,
  winner_user_id  TEXT        NOT NULL,
  reason          TEXT,                  -- gear | trait | litho
  rolled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  roll_value      INT,
  win_count       INT         DEFAULT 1
);

-- sinnvolle Indizes (idempotent)
CREATE INDEX IF NOT EXISTS wins_guild_item_idx
  ON wins (guild_id, item_slug);

CREATE INDEX IF NOT EXISTS wins_guild_item_user_idx
  ON wins (guild_id, item_slug, winner_user_id);

CREATE INDEX IF NOT EXISTS wins_guild_item_time_idx
  ON wins (guild_id, item_slug, rolled_at DESC);
