import { describe, expect, it } from 'vitest';
import { singleFlight } from './singleFlight.js';

describe('singleFlight', () => {
  it('shares one run between calls made while it is in flight', async () => {
    let runs = 0;
    let finish: (value: string) => void = () => {};
    const launch = singleFlight(() => {
      runs += 1;
      return new Promise<string>((resolve) => (finish = resolve));
    });
    const first = launch();
    const second = launch();
    finish('ready');
    expect(await first).toBe('ready');
    expect(await second).toBe('ready');
    expect(runs).toBe(1);
  });
  it('runs again once the previous run has settled', async () => {
    let runs = 0;
    const launch = singleFlight(async () => ++runs);
    expect(await launch()).toBe(1);
    expect(await launch()).toBe(2);
  });
  it('gives every waiting caller the failure and allows a retry', async () => {
    let runs = 0;
    const launch = singleFlight(async () => {
      runs += 1;
      if (runs === 1) throw new Error('wrong password');
      return runs;
    });
    const first = launch();
    const second = launch();
    await expect(first).rejects.toThrow('wrong password');
    await expect(second).rejects.toThrow('wrong password');
    expect(await launch()).toBe(2);
  });
});
