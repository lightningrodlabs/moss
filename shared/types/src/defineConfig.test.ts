import { describe, expect, it } from 'vitest';
import { normalizeDevConfig, type WeaveDevConfigInput } from './defineConfig';

const tool = {
  name: 'Forum',
  subtitle: 'A forum',
  description: 'Posts',
  icon: { type: 'https' as const, url: 'https://example.com/icon.png' },
  source: { type: 'localhost' as const, happPath: './forum.happ', uiPort: 8888 },
};

const install = { name: 'Forum', instanceName: 'Forum', registeringAgent: 1, joiningAgents: [2] };

function group(extra: object) {
  return {
    name: 'G',
    networkSeed: 'seed',
    icon: { type: 'https' as const, url: 'https://example.com/g.png' },
    creatingAgent: { agentIdx: 1, agentProfile: { nickname: 'A' } },
    joiningAgents: [],
    ...extra,
  };
}

describe('normalizeDevConfig', () => {
  it('reads Tools from the tools fields', () => {
    const input: WeaveDevConfigInput = {
      groups: [group({ tools: [install] })],
      tools: [tool],
      toolCurations: [],
    };
    const config = normalizeDevConfig(input);
    expect(config.applets).toEqual([tool]);
    expect(config.groups[0].applets).toEqual([install]);
  });

  it('still reads the legacy applets fields', () => {
    const input: WeaveDevConfigInput = {
      groups: [group({ applets: [install] })],
      applets: [tool],
      toolCurations: [],
    };
    const config = normalizeDevConfig(input);
    expect(config.applets).toEqual([tool]);
    expect(config.groups[0].applets).toEqual([install]);
  });

  it('defaults missing Tool lists to empty arrays', () => {
    const config = normalizeDevConfig({ groups: [group({})], toolCurations: [] });
    expect(config.applets).toEqual([]);
    expect(config.groups[0].applets).toEqual([]);
  });

  it('rejects a config that uses both spellings', () => {
    expect(() =>
      normalizeDevConfig({ groups: [], tools: [tool], applets: [tool], toolCurations: [] }),
    ).toThrow(/either "tools" or "applets"/);
    expect(() =>
      normalizeDevConfig({
        groups: [group({ tools: [install], applets: [install] })],
        tools: [tool],
        toolCurations: [],
      }),
    ).toThrow(/either "tools" or "applets"/);
  });
});
