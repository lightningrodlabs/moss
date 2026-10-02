import { describe, expect, it } from 'vitest';
import { liveAgentIdsFromAgentInfo } from './agent-info.js';

const signed = (info: Record<string, unknown>) =>
  JSON.stringify({ agentInfo: JSON.stringify(info), signature: 'sig' });

describe('liveAgentIdsFromAgentInfo', () => {
  it('returns the agent ids of reachable agents', () => {
    expect(
      liveAgentIdsFromAgentInfo([
        signed({ agent: 'aaa', isTombstone: false, url: 'wss://x' }),
        signed({ agent: 'bbb', isTombstone: false, url: 'wss://y' }),
      ]),
    ).toEqual(['aaa', 'bbb']);
  });

  it('skips agents that declared themselves gone with a tombstone', () => {
    expect(
      liveAgentIdsFromAgentInfo([
        signed({ agent: 'left', isTombstone: true }),
        signed({ agent: 'here', isTombstone: false, url: 'wss://y' }),
      ]),
    ).toEqual(['here']);
  });

  it('accepts already-parsed items and skips malformed ones', () => {
    expect(
      liveAgentIdsFromAgentInfo([
        { agentInfo: JSON.stringify({ agent: 'ccc' }), signature: 'sig' },
        'not json',
        signed({ isTombstone: false }),
      ]),
    ).toEqual(['ccc']);
  });
});
