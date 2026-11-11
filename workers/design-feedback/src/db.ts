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
       VALUES (?, ?, 'open', ?, ?, ?, ?)`,
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
