import fs from 'node:fs';
import path from 'node:path';
import type { FeedbackCommentWire } from '@theweave/utils';

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
  /** Issue thread as last synced; absent on records that were never synced. */
  comments?: FeedbackCommentWire[];
  /** Seconds; team comments created after this count as unread. */
  lastReadAt?: number;
  /** Seconds; the issue's updatedAt at the last sync, used as the next sync cursor. */
  issueUpdatedAt?: number;
  stateReason?: string;
  title?: string;
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

const ID_PATTERN = /^\d+-[a-z0-9]+$/;
const SAVE_ATTEMPTS = 5;

/** Persists each feedback submission as `<dir>/<id>.json`. */
export class FeedbackRecordStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Resolves an id to its file, or undefined when the id could escape the store directory. */
  private fileFor(id: string): string | undefined {
    return ID_PATTERN.test(id) ? path.join(this.dir, `${id}.json`) : undefined;
  }

  save(record: Omit<FeedbackRecord, 'id'>): FeedbackRecord {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const id = `${record.timestamp}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
      const file = this.fileFor(id);
      if (!file) throw new Error(`Invalid feedback record timestamp: ${record.timestamp}`);
      const saved: FeedbackRecord = { ...record, id };
      try {
        fs.writeFileSync(file, JSON.stringify(saved, null, 2), { flag: 'wx' });
        return saved;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    throw new Error('Could not allocate a unique feedback record id');
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
    const file = this.fileFor(id);
    if (!file) return undefined;
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredRecord;
      return normalize(stored);
    } catch {
      return undefined;
    }
  }

  update(id: string, patch: Partial<Omit<FeedbackRecord, 'id'>>): FeedbackRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const updated: FeedbackRecord = { ...existing, ...patch, id };
    const file = this.fileFor(id);
    if (!file) return undefined;
    fs.writeFileSync(file, JSON.stringify(updated, null, 2));
    return updated;
  }
}
