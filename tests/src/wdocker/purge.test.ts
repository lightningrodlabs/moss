import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirmMock = vi.fn();
const rmSyncMock = vi.fn().mockImplementation(() => undefined);

vi.mock('@inquirer/prompts', () => ({
  confirm: confirmMock,
}));

vi.mock('fs', () => ({
  default: {
    rmSync: rmSyncMock,
  },
  rmSync: rmSyncMock,
}));

vi.mock('../../../wdocker/src/const.js', () => ({
  GROUP_HAPP_URL: 'https://example.test/group.happ',
  MOSS_CONFIG: { groupHapp: { sha256: '' } },
  PACKAGE_JSON: { version: '0.0.0' },
}));

vi.mock('../../../wdocker/src/filesystem.js', async () => {
  const actual = await vi.importActual<typeof import('../../../wdocker/src/filesystem.js')>(
    '../../../wdocker/src/filesystem.js',
  );
  return {
    ...actual,
    WDockerFilesystem: class {
      constructor() { }
      conductorExists() {
        return true;
      }
      setConductorId() { }
      get conductorDataDir() {
        return '/tmp/conductor';
      }
    },
  };
});

const { purgeConductor } = await import('../../../wdocker/src/commands/purge.js');

describe('purgeConductor confirmation handling', () => {
  const conductorId = 'test-conductor';

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WDOCKER_PURGE_CONFIRM;
  });

  it('aborts when purge confirmation is set to a non-true value', async () => {
    process.env.WDOCKER_PURGE_CONFIRM = 'false';

    await expect(purgeConductor(conductorId)).resolves.toBeUndefined();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(rmSyncMock).not.toHaveBeenCalled();
  });

  it('deletes the conductor without prompting when purge confirmation is set to true', async () => {
    process.env.WDOCKER_PURGE_CONFIRM = 'true';

    await expect(purgeConductor(conductorId)).resolves.toBeUndefined();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(rmSyncMock).toHaveBeenCalledTimes(1);
  });

  it('uses interactive confirmation when the env var is not set', async () => {
    confirmMock.mockResolvedValue(true);

    await expect(purgeConductor(conductorId)).resolves.toBeUndefined();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(rmSyncMock).toHaveBeenCalledTimes(1);
  });
});
