export type IssueRow = {
  number: number;
  reporterId: string;
  title: string;
  /** Seconds since the epoch. */
  createdAt: number;
  createdVia: 'worker' | 'github';
};

/** Records a reporter the first time they file; later runs leave the stored row untouched. */
function upsertReporterStatement(
  db: D1Database,
  reporterId: string,
  pubKey: Uint8Array,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO reporters (reporter_id, pubkey, created_at) VALUES (?, ?, ?) ON CONFLICT(reporter_id) DO NOTHING',
    )
    .bind(reporterId, pubKey, now);
}

/** Records a newly opened issue in state 'open'. */
function insertIssueStatement(db: D1Database, row: IssueRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO issues (number, reporter_id, state, title, created_at, updated_at, created_via)
       VALUES (?, ?, 'open', ?, ?, ?, ?)
       ON CONFLICT(number) DO NOTHING`,
    )
    .bind(row.number, row.reporterId, row.title, row.createdAt, row.createdAt, row.createdVia);
}

/**
 * Records the reporter and their new issue in one transaction, so an issue row
 * never exists without its reporter and a failure leaves neither behind.
 */
export async function recordIssue(
  db: D1Database,
  reporter: { reporterId: string; pubKey: Uint8Array },
  row: IssueRow,
): Promise<void> {
  await db.batch([
    upsertReporterStatement(db, reporter.reporterId, reporter.pubKey, row.createdAt),
    insertIssueStatement(db, row),
  ]);
}

export type CommentRow = {
  id: number;
  issueNumber: number;
  authorLogin: string;
  authorAssociation: string;
  postedForReporter: boolean;
  body: string;
  /** Seconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type StoredIssue = {
  number: number;
  reporterId: string;
  state: 'open' | 'closed';
  stateReason?: string;
  title: string;
  /** Seconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  createdVia: 'worker' | 'github';
};

type IssueDbRow = {
  number: number;
  reporter_id: string;
  state: 'open' | 'closed';
  state_reason: string | null;
  title: string;
  created_at: number;
  updated_at: number;
  created_via: 'worker' | 'github';
};

type CommentDbRow = {
  id: number;
  issue_number: number;
  author_login: string;
  author_association: string;
  posted_for_reporter: number;
  body: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

function toCommentRow(r: CommentDbRow): CommentRow {
  const row: CommentRow = {
    id: r.id,
    issueNumber: r.issue_number,
    authorLogin: r.author_login,
    authorAssociation: r.author_association,
    postedForReporter: r.posted_for_reporter === 1,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.deleted_at !== null) row.deletedAt = r.deleted_at;
  return row;
}

export async function getIssue(db: D1Database, number: number): Promise<StoredIssue | undefined> {
  const r = await db
    .prepare('SELECT * FROM issues WHERE number = ?')
    .bind(number)
    .first<IssueDbRow>();
  if (!r) return undefined;
  const issue: StoredIssue = {
    number: r.number,
    reporterId: r.reporter_id,
    state: r.state,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdVia: r.created_via,
  };
  if (r.state_reason !== null) issue.stateReason = r.state_reason;
  return issue;
}

/** Mirrors GitHub's view of an issue; the reporter and origin are fixed by whoever stored it first. */
export async function upsertIssue(db: D1Database, row: StoredIssue): Promise<void> {
  await db
    .prepare(
      `INSERT INTO issues (number, reporter_id, state, state_reason, title, created_at, updated_at, created_via)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(number) DO UPDATE SET
         state = excluded.state, state_reason = excluded.state_reason,
         title = excluded.title, updated_at = excluded.updated_at`,
    )
    .bind(
      row.number,
      row.reporterId,
      row.state,
      row.stateReason ?? null,
      row.title,
      row.createdAt,
      row.updatedAt,
      row.createdVia,
    )
    .run();
}

/** Removes an issue together with its comments. */
export async function deleteIssue(db: D1Database, number: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM comments WHERE issue_number = ?').bind(number),
    db.prepare('DELETE FROM issues WHERE number = ?').bind(number),
  ]);
}

/** Stores a comment; `posted_for_reporter` is fixed at first insert because webhook echoes omit it. */
export async function upsertComment(db: D1Database, row: CommentRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO comments (id, issue_number, author_login, author_association, posted_for_reporter,
         body, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         body = excluded.body, updated_at = excluded.updated_at,
         author_association = excluded.author_association, deleted_at = excluded.deleted_at`,
    )
    .bind(
      row.id,
      row.issueNumber,
      row.authorLogin,
      row.authorAssociation,
      row.postedForReporter ? 1 : 0,
      row.body,
      row.createdAt,
      row.updatedAt,
      row.deletedAt ?? null,
    )
    .run();
}

/** Marks a comment deleted and bumps its update time so incremental readers see the deletion. */
export async function softDeleteComment(
  db: D1Database,
  id: number,
  deletedAt: number,
): Promise<void> {
  await db
    .prepare('UPDATE comments SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .bind(deletedAt, deletedAt, id)
    .run();
}

export async function commentsSince(
  db: D1Database,
  issueNumber: number,
  since: number,
): Promise<CommentRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM comments WHERE issue_number = ? AND updated_at > ? ORDER BY created_at, id',
    )
    .bind(issueNumber, since)
    .all<CommentDbRow>();
  return results.map(toCommentRow);
}

/** Advances an issue's update time, never moving it backwards. */
export async function touchIssue(db: D1Database, number: number, updatedAt: number): Promise<void> {
  await db
    .prepare('UPDATE issues SET updated_at = MAX(updated_at, ?) WHERE number = ?')
    .bind(updatedAt, number)
    .run();
}
