import fs from 'node:fs';
import path from 'node:path';

export type FeedbackRecord = {
  id: string;
  text: string;
  screenshot: string;
  mossVersion: string;
  os: string;
  timestamp: number;
  reporterId?: string;
  githubHandle?: string;
  issueNumber?: number;
  issueUrl?: string;
  state: 'open' | 'closed' | 'local-only';
  createdVia?: 'worker' | 'github';
};

export type FeedbackRecordSummary = Omit<FeedbackRecord, 'screenshot'>;

type StoredRecord = Omit<FeedbackRecord, 'state'> & { state?: FeedbackRecord['state'] };

/** Fills in the fields that records written before issue tracking do not have. */
function normalize(stored: StoredRecord): FeedbackRecord {
  const issueNumber =
    stored.issueNumber ?? (stored.issueUrl ? parseIssueNumber(stored.issueUrl) : undefined);
  const state = stored.state ?? (stored.issueUrl ? 'open' : 'local-only');
  const record: FeedbackRecord = { ...stored, state };
  if (issueNumber !== undefined) record.issueNumber = issueNumber;
  return record;
}

function parseIssueNumber(issueUrl: string): number | undefined {
  const match = /\/issues\/(\d+)\/?$/.exec(issueUrl);
  return match ? Number(match[1]) : undefined;
}

/** Persists each feedback submission as `<dir>/<id>.json`. */
export class FeedbackRecordStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  save(record: Omit<FeedbackRecord, 'id'>): FeedbackRecord {
    const id = `${record.timestamp}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
    const saved: FeedbackRecord = { ...record, id };
    fs.writeFileSync(this.fileFor(id), JSON.stringify(saved, null, 2));
    return saved;
  }

  list(): FeedbackRecordSummary[] {
    const summaries: FeedbackRecordSummary[] = [];
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      const record = this.get(file.slice(0, -'.json'.length));
      if (!record) continue;
      const { screenshot: _screenshot, ...summary } = record;
      summaries.push(summary);
    }
    return summaries.sort((a, b) => b.timestamp - a.timestamp);
  }

  get(id: string): FeedbackRecord | undefined {
    try {
      const stored = JSON.parse(fs.readFileSync(this.fileFor(id), 'utf8')) as StoredRecord;
      return normalize(stored);
    } catch {
      return undefined;
    }
  }

  update(id: string, patch: Partial<Omit<FeedbackRecord, 'id'>>): FeedbackRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const updated: FeedbackRecord = { ...existing, ...patch, id };
    fs.writeFileSync(this.fileFor(id), JSON.stringify(updated, null, 2));
    return updated;
  }
}
