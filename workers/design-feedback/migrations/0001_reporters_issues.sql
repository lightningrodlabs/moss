CREATE TABLE reporters (reporter_id TEXT PRIMARY KEY, pubkey BLOB NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE issues (number INTEGER PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES reporters(reporter_id),
  state TEXT NOT NULL, state_reason TEXT, title TEXT NOT NULL, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, created_via TEXT NOT NULL);
CREATE INDEX issues_reporter ON issues(reporter_id);
