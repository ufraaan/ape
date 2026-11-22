CREATE TABLE pastes (
  id TEXT PRIMARY KEY NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  delete_token_hash TEXT NOT NULL
);

CREATE INDEX idx_pastes_expires_at ON pastes (expires_at);
