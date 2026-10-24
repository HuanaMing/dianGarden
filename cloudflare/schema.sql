CREATE TABLE IF NOT EXISTS player_saves (
  user_id TEXT PRIMARY KEY NOT NULL,
  save_data TEXT NOT NULL,
  variants_data TEXT NOT NULL,
  auto_crops_data TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_saves_updated_at
  ON player_saves(updated_at);
