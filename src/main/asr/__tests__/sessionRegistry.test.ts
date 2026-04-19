import { describe, expect, it } from 'vitest';

import type { AsrSession } from '../session';
import { SessionRegistry } from '../sessionRegistry';

// We don't need a real session; only an opaque reference for identity
// in these tests.
function fakeSession(label: string): AsrSession {
  return { _label: label } as unknown as AsrSession;
}

describe('SessionRegistry', () => {
  it('register() returns a unique id and stores the entry', () => {
    let counter = 0;
    const reg = new SessionRegistry(() => `id-${counter++}`);
    const s = fakeSession('a');

    const id = reg.register(s, 100);
    expect(id).toBe('id-0');
    const entry = reg.get(id);
    expect(entry?.session).toBe(s);
    expect(entry?.ownerId).toBe(100);
    expect(reg.size).toBe(1);
  });

  it('remove() drops the entry and returns true exactly once', () => {
    const reg = new SessionRegistry(() => 'fixed');
    reg.register(fakeSession('a'), 1);
    expect(reg.remove('fixed')).toBe(true);
    expect(reg.remove('fixed')).toBe(false);
    expect(reg.size).toBe(0);
  });

  it('idsForOwner() returns only the matching ids', () => {
    let n = 0;
    const reg = new SessionRegistry(() => `id-${n++}`);
    reg.register(fakeSession('a'), 100);
    reg.register(fakeSession('b'), 200);
    reg.register(fakeSession('c'), 100);

    const owned = reg.idsForOwner(100).sort();
    expect(owned).toEqual(['id-0', 'id-2']);
    expect(reg.idsForOwner(200)).toEqual(['id-1']);
    expect(reg.idsForOwner(999)).toEqual([]);
  });

  it('removeAllForOwner() removes only the matching entries and returns them', () => {
    let n = 0;
    const reg = new SessionRegistry(() => `id-${n++}`);
    const a = fakeSession('a');
    const b = fakeSession('b');
    const c = fakeSession('c');
    reg.register(a, 100);
    reg.register(b, 200);
    reg.register(c, 100);

    const removed = reg.removeAllForOwner(100);
    expect(removed.map((r) => r.id).sort()).toEqual(['id-0', 'id-2']);
    expect(removed.find((r) => r.id === 'id-0')?.session).toBe(a);
    expect(reg.size).toBe(1);
    expect(reg.get('id-1')?.session).toBe(b);
  });

  it('removeAllForOwner() on an unknown owner is a no-op', () => {
    const reg = new SessionRegistry(() => 'x');
    reg.register(fakeSession('a'), 1);
    const removed = reg.removeAllForOwner(999);
    expect(removed).toEqual([]);
    expect(reg.size).toBe(1);
  });
});
