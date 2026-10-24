ALTER TABLE player_saves ADD COLUMN opened_at INTEGER;
ALTER TABLE player_saves ADD COLUMN saved_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_player_saves_opened_at
  ON player_saves(opened_at);
