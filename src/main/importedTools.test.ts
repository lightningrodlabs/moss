import { describe, it, expect } from 'vitest';
import { curatedToolsFromCuration, resolveImportedTool } from './importedTools';

const LIST_016 = 'https://lightningrodlabs.org/weave-tool-curation/0.16/tool-list-0.16.json';
const LIST_015 = 'https://lightningrodlabs.org/weave-tool-curation/0.15/tool-list-0.15.json';

const curation = {
  curator: { name: 'LRL' },
  curationLists: {
    default: {
      tools: [
        { toolListUrl: LIST_016, toolId: 'vines', versionBranch: '1.30.x' },
        { toolListUrl: LIST_016, toolId: 'matthme.presence', versionBranch: '0.17.x' },
      ],
    },
    other: { tools: [{ toolListUrl: LIST_016, toolId: 'kando', versionBranch: '0.19.x' }] },
  },
};

describe('curatedToolsFromCuration', () => {
  it('reads the tools of the requested lists', () => {
    expect(curatedToolsFromCuration(curation, ['default']).map((t) => t.toolId)).toEqual([
      'vines',
      'matthme.presence',
    ]);
  });

  it('ignores lists that are missing or malformed', () => {
    expect(curatedToolsFromCuration({ curationLists: {} }, ['default'])).toEqual([]);
    expect(curatedToolsFromCuration(null, ['default'])).toEqual([]);
  });
});

describe('resolveImportedTool', () => {
  const curated = curatedToolsFromCuration(curation, ['default']);
  const vines015 = { toolId: 'vines', toolListUrl: LIST_015, versionBranch: '1.22.x' };
  const unyt015 = {
    toolId: 'unyt',
    toolListUrl: 'https://example.org/0.15.json',
    versionBranch: '0.90.x',
  };

  it('uses the curated version of a tool when one exists', () => {
    expect(resolveImportedTool(vines015, curated, true)).toEqual({
      toolListUrl: LIST_016,
      versionBranch: '1.30.x',
    });
  });

  it('reports a tool from an older version that is not curated as unavailable', () => {
    expect(resolveImportedTool(unyt015, curated, true)).toBeUndefined();
  });

  it('keeps the exported source when curation is not required', () => {
    expect(resolveImportedTool(unyt015, curated, false)).toEqual({
      toolListUrl: unyt015.toolListUrl,
      versionBranch: '0.90.x',
    });
  });
});
