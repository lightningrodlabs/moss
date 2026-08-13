import { describe, expect, it } from 'vitest';
import type { AppInfo, AppStatus } from '@holochain/client';
import { appIdFromAppletHash } from '@theweave/utils';
import { partitionAppletsByStatus } from './applet-status';

const appletHash = (fill: number) => new Uint8Array(39).fill(fill);

const appStatus = (status: AppStatus['type']): AppStatus =>
  status === 'disabled' ? { type: 'disabled', value: { type: 'user' } } : { type: status };

const app = (id: string, status: AppStatus['type']): AppInfo =>
  ({
    installed_app_id: id,
    status: appStatus(status),
  }) as AppInfo;

describe('partitionAppletsByStatus', () => {
  const running = appletHash(1);
  const disabled = appletHash(2);
  const notInstalled = appletHash(3);
  const awaiting = appletHash(4);
  const apps = [
    app(appIdFromAppletHash(running), 'enabled'),
    app(appIdFromAppletHash(disabled), 'disabled'),
    app(appIdFromAppletHash(awaiting), 'awaiting_memproofs'),
    app('group#some-group', 'enabled'),
  ];

  it('partitions joined applets by conductor status', () => {
    const result = partitionAppletsByStatus([running, disabled, notInstalled, awaiting], apps);
    expect(result.installed).toEqual([running, disabled, awaiting]);
    expect(result.running).toEqual([running]);
    expect(result.disabled).toEqual([disabled]);
  });

  it('treats a joined-but-uninstalled applet as absent everywhere', () => {
    const result = partitionAppletsByStatus([notInstalled], apps);
    expect(result).toEqual({ installed: [], running: [], disabled: [] });
  });

  it('is empty for no joined applets', () => {
    expect(partitionAppletsByStatus([], apps)).toEqual({
      installed: [],
      running: [],
      disabled: [],
    });
  });
});
