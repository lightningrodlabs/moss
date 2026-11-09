/** Records a reporter the first time they file; later calls leave the stored row untouched. */
export async function upsertReporter(db: D1Database, reporterId: string, pubKey: Uint8Array, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO reporters (reporter_id, pubkey, created_at) VALUES (?, ?, ?) ON CONFLICT(reporter_id) DO NOTHING')
    .bind(reporterId, pubKey, now)
    .run();
}

/** Records a newly opened issue. `createdAt` is in seconds. */
export async function insertIssue(
  db: D1Database,
  row: { number: number; reporterId: string; title: string; createdAt: number; createdVia: 'worker' | 'github' },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO issues (number, reporter_id, state, title, created_at, updated_at, created_via)
       VALUES (?, ?, 'open', ?, ?, ?, ?)`,
    )
    .bind(row.number, row.reporterId, row.title, row.createdAt, row.createdAt, row.createdVia)
    .run();
}
