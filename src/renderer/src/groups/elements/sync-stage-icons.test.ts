import { describe, expect, it } from 'vitest';
import { stageIcon } from './sync-stage-icons.js';

describe('stageIcon', () => {
  it('searches with the empty radar', () => {
    expect(stageIcon('no-peers')).toBe('radar');
  });
  it('shows the radar with a blip for peers that are found, reachable or not', () => {
    expect(stageIcon('found')).toBe('radar-blip');
    expect(stageIcon('unreachable')).toBe('radar-blip');
  });
  it('shows the partial mesh while syncing and the full mesh once synced', () => {
    expect(stageIcon('connected')).toBe('mesh-partial');
    expect(stageIcon('synced')).toBe('mesh-full');
  });
});
