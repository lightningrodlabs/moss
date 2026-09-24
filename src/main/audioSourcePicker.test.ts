import { describe, it, expect } from 'vitest';
import type { AudioSourcePickerRequest, AudioSourceRow } from '@theweave/moss-types';
import { InWindowAudioSourcePicker, type PickerWindow } from './audioSourcePicker';

class FakeWindow implements PickerWindow {
  sent: AudioSourcePickerRequest[] = [];
  focused = 0;
  destroyed = false;
  private goneListeners: Array<() => void> = [];
  constructor(readonly id: number) {}
  isDestroyed() {
    return this.destroyed;
  }
  showPicker(request: AudioSourcePickerRequest) {
    this.sent.push(request);
  }
  focus() {
    this.focused++;
  }
  onGone(listener: () => void) {
    this.goneListeners.push(listener);
    return () => {
      this.goneListeners = this.goneListeners.filter((l) => l !== listener);
    };
  }
  gone() {
    this.destroyed = true;
    for (const l of [...this.goneListeners]) l();
  }
  get listenerCount() {
    return this.goneListeners.length;
  }
}

const ROWS: AudioSourceRow[] = [
  { id: 'system', kind: 'system', name: 'All system output (except Moss)', playing: null },
  { id: 'app-0', kind: 'app', name: 'Firefox', playing: true },
];
const REQUESTER = { targetId: 7, toolName: 'Presence' };

function rig() {
  const windows = new Map<number, FakeWindow>([
    [7, new FakeWindow(7)],
    [8, new FakeWindow(8)],
  ]);
  let ids = 0;
  const picker = new InWindowAudioSourcePicker({
    lookup: (id) => windows.get(id),
    newId: () => `p${++ids}`,
  });
  return { picker, target: windows.get(7)!, other: windows.get(8)! };
}

describe('InWindowAudioSourcePicker', () => {
  it('shows the rows and the Tool name in the requesting window and focuses it', async () => {
    const r = rig();
    void r.picker.open(ROWS, REQUESTER);
    expect(r.target.sent).toEqual([{ pickerId: 'p1', toolName: 'Presence', rows: ROWS }]);
    expect(r.target.focused).toBe(1);
    expect(r.other.sent).toEqual([]);
  });

  it('resolves the ids the requesting window chose', async () => {
    const r = rig();
    const chosen = r.picker.open(ROWS, REQUESTER);
    r.picker.answer(7, 'p1', ['app-0']);
    expect(await chosen).toEqual(['app-0']);
  });

  it('ignores an answer from any other window', async () => {
    const r = rig();
    const chosen = r.picker.open(ROWS, REQUESTER);
    r.picker.answer(8, 'p1', ['system']);
    r.picker.answer(7, 'p1', null);
    expect(await chosen).toBeNull();
  });

  it('ignores an answer for a different picker id', async () => {
    const r = rig();
    const chosen = r.picker.open(ROWS, REQUESTER);
    r.picker.answer(7, 'stale', ['system']);
    r.picker.answer(7, 'p1', ['app-0']);
    expect(await chosen).toEqual(['app-0']);
  });

  it('drops ids that were not offered', async () => {
    const r = rig();
    const chosen = r.picker.open(ROWS, REQUESTER);
    r.picker.answer(7, 'p1', ['app-0', 'app-99', 'system']);
    expect(await chosen).toEqual(['app-0', 'system']);
  });

  it('the requesting window going away cancels and stops watching it', async () => {
    const r = rig();
    const chosen = r.picker.open(ROWS, REQUESTER);
    r.target.gone();
    expect(await chosen).toBeNull();
    expect(r.target.listenerCount).toBe(0);
  });

  it('an answer stops watching the window', async () => {
    const r = rig();
    const chosen = r.picker.open(ROWS, REQUESTER);
    r.picker.answer(7, 'p1', null);
    await chosen;
    expect(r.target.listenerCount).toBe(0);
  });

  it('a missing or destroyed requesting window cancels at once', async () => {
    const r = rig();
    expect(await r.picker.open(ROWS, { ...REQUESTER, targetId: 99 })).toBeNull();
    r.target.destroyed = true;
    expect(await r.picker.open(ROWS, REQUESTER)).toBeNull();
    expect(r.target.sent).toEqual([]);
  });
});
