CREATE TABLE comments (id INTEGER PRIMARY KEY, issue_number INTEGER NOT NULL REFERENCES issues(number),
  author_login TEXT NOT NULL, author_association TEXT NOT NULL, posted_for_reporter INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE INDEX comments_issue_updated ON comments(issue_number, updated_at);
