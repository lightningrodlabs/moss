import { beforeEach, describe, expect, it, vi } from 'vitest';

const passwordInputMock = vi.fn();

vi.mock('@inquirer/prompts', () => ({
  password: passwordInputMock,
}));

vi.mock('../../../wdocker/src/const.js', () => ({
  GROUP_HAPP_URL: 'https://example.test/group.happ',
  MOSS_CONFIG: { groupHapp: { sha256: '' } },
}));

const { getPassword, getInitPassword } = await import('../../../wdocker/src/helpers/helpers.js');

describe('wdocker password helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WDOCKER_PASSWORD;
  });

  it('uses an explicitly set empty env var as an error instead of prompting', async () => {
    process.env.WDOCKER_PASSWORD = '';
    passwordInputMock.mockResolvedValue('prompted');

    await expect(getPassword()).rejects.toThrow('WDOCKER_PASSWORD must be a non-empty value');
    expect(passwordInputMock).not.toHaveBeenCalled();
  });

  it('returns the password from the environment when provided', async () => {
    process.env.WDOCKER_PASSWORD = 'secret';
    passwordInputMock.mockResolvedValue('prompted');

    const password = await getPassword();

    expect(password).toBe('secret');
    expect(passwordInputMock).not.toHaveBeenCalled();
  });

  it('cleans up the environment variable after reading it', async () => {
    process.env.WDOCKER_PASSWORD = 'secret';
    passwordInputMock.mockResolvedValue('prompted');

    const password = await getPassword();

    expect(password).toBe('secret');
    expect(process.env.WDOCKER_PASSWORD).toBeUndefined();
  });

  it('rejects empty env password during initialization and does not prompt', async () => {
    process.env.WDOCKER_PASSWORD = '';
    passwordInputMock.mockResolvedValue('prompted');

    await expect(getInitPassword()).rejects.toThrow('WDOCKER_PASSWORD must be a non-empty value');
    expect(passwordInputMock).not.toHaveBeenCalled();
  });
});
