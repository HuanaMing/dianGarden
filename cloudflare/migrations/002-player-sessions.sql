-- Task 232: add game-owned long-lived login sessions.
-- Apply to the existing Cloudflare D1 database before deploying the updated Worker.
CREATE TABLE IF NOT EXISTS player_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  access_token_hash TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_player_sessions_user_id
  ON player_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_player_sessions_idle_expires_at
  ON player_sessions(idle_expires_at);
