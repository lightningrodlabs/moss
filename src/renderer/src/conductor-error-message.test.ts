import { describe, it, expect } from 'vitest';
import { conductorErrorMessage } from './conductor-error-message.js';

describe('conductorErrorMessage', () => {
  it('explains the init timeout', () => {
    expect(
      conductorErrorMessage(new Error('... triggered the `init()` callback ...')),
    ).toMatch(/still setting up this group/);
  });
  it('explains a client timeout', () => {
    expect(
      conductorErrorMessage(new Error('Request timed out in 60000 ms: call_zome')),
    ).toMatch(/did not answer in time/);
  });
  it('passes other messages through', () => {
    expect(conductorErrorMessage(new Error('boom'))).toBe('boom');
    expect(conductorErrorMessage('plain')).toBe('plain');
  });
});
