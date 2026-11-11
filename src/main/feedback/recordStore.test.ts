import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackRecordStore, type FeedbackRecord } from './recordStore';

const base: Omit<FeedbackRecord, 'id'> = {
  text: 'hello',
  screenshot: 'data:image/png;base64,AAAA',
  mossVersion: '0.16.0',
  os: 'linux',
  timestamp: 100,
  state: 'local-only',
};

describe('FeedbackRecordStore', () => {
  let dir: string;
  let store: FeedbackRecordStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-store-'));
    store = new FeedbackRecordStore(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('save then get round trips and list omits the screenshot', () => {
    const saved = store.save(base);
    expect(saved.id).toMatch(/^100-[a-z0-9]{6}$/);
    expect(store.get(saved.id)).toEqual(saved);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, `${saved.id}.json`), 'utf8'));
    expect(onDisk).toEqual(saved);
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('screenshot');
    expect(list[0].text).toBe('hello');
  });

  it('list is newest first and skips non-json and unparsable files', () => {
    const a = store.save({ ...base, timestamp: 1 });
    const b = store.save({ ...base, timestamp: 3 });
    const c = store.save({ ...base, timestamp: 2 });
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
    expect(store.list().map((r) => r.id)).toEqual([b.id, c.id, a.id]);
  });

  it('update merges a patch and persists it', () => {
    const saved = store.save(base);
    const updated = store.update(saved.id, { state: 'open', issueNumber: 7 });
    expect(updated).toMatchObject({ id: saved.id, text: 'hello', state: 'open', issueNumber: 7 });
    expect(store.get(saved.id)).toEqual(updated);
    expect(store.update('nope', { state: 'closed' })).toBeUndefined();
  });

  it('a legacy record with issueUrl reads as open with its issue number parsed', () => {
    fs.writeFileSync(
      path.join(dir, '1-a.json'),
      JSON.stringify({
        id: '1-a',
        text: 't',
        screenshot: '',
        mossVersion: '',
        os: '',
        timestamp: 1,
        issueUrl: 'https://github.com/o/r/issues/42',
      }),
    );
    expect(store.get('1-a')).toMatchObject({ state: 'open', issueNumber: 42 });
  });

  it('a legacy record without issueUrl reads as local-only', () => {
    fs.writeFileSync(
      path.join(dir, '2-b.json'),
      JSON.stringify({
        id: '2-b',
        text: 't',
        screenshot: '',
        mossVersion: '',
        os: '',
        timestamp: 2,
      }),
    );
    const rec = store.get('2-b');
    expect(rec?.state).toBe('local-only');
    expect(rec?.issueNumber).toBeUndefined();
  });

  it('get of an unknown id is undefined', () => {
    expect(store.get('missing')).toBeUndefined();
  });

  it('get and update reject ids that could leave the store directory', () => {
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside.json`);
    fs.writeFileSync(outside, JSON.stringify({ id: 'x', text: 't', timestamp: 1 }));
    try {
      const relative = `../${path.basename(outside, '.json')}`;
      for (const id of [relative, '../x', 'a/b']) {
        expect(store.get(id)).toBeUndefined();
        expect(store.update(id, { text: 'changed' })).toBeUndefined();
      }
      expect(JSON.parse(fs.readFileSync(outside, 'utf8')).text).toBe('t');
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('save never overwrites an existing record', () => {
    const a = store.save(base);
    const b = store.save(base);
    expect(a.id).not.toBe(b.id);
    expect(fs.readdirSync(dir)).toHaveLength(2);
  });

  it('save retries with a new suffix when the id already exists', () => {
    const rand = vi.spyOn(Math, 'random');
    rand.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const a = store.save(base);
    const b = store.save(base);
    rand.mockRestore();
    expect(a.id).not.toBe(b.id);
    expect(store.get(a.id)).toEqual(a);
    expect(store.get(b.id)).toEqual(b);
  });
  it('round trips thread fields through save, update and get', () => {
    const comment = {
      id: 1,
      authorLogin: 'a',
      authorAssociation: 'MEMBER',
      postedForReporter: false,
      body: 'hi',
      createdAt: 5,
      updatedAt: 5,
      deleted: false,
    };
    const saved = store.save({ ...base, comments: [comment], lastReadAt: 3 });
    expect(store.get(saved.id)?.comments).toEqual([comment]);
    store.update(saved.id, { issueUpdatedAt: 9, stateReason: 'completed', title: 'T' });
    const got = store.get(saved.id);
    expect(got).toMatchObject({
      issueUpdatedAt: 9,
      stateReason: 'completed',
      title: 'T',
      lastReadAt: 3,
    });
    expect(got?.comments).toEqual([comment]);
  });

  it('loads legacy files without thread fields', () => {
    fs.writeFileSync(
      path.join(dir, '100-abcdef.json'),
      JSON.stringify({
        id: '100-abcdef',
        text: 't',
        screenshot: '',
        mossVersion: '1',
        os: 'l',
        timestamp: 100,
      }),
    );
    const got = store.get('100-abcdef');
    expect(got?.comments).toBeUndefined();
    expect(got?.state).toBe('local-only');
  });
});
