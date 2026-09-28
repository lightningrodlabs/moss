import { describe, it, expect } from 'vitest';
import { assertValidRequest } from './request-validation';

describe('assertValidRequest', () => {
  it('accepts a well-formed request', () => {
    expect(() => assertValidRequest({ type: 'user-select-screen' })).not.toThrow();
  });

  it('throws for a malformed request, naming its type, so the host replies with an error', () => {
    expect(() => assertValidRequest({ type: 'request-audio-sources', pid: 5 })).toThrow(
      /request-audio-sources/,
    );
  });

  it('throws for a request with an unknown type', () => {
    expect(() => assertValidRequest({ type: 'no-such-request' })).toThrow(/no-such-request/);
  });

  it('throws for a message that is not an object', () => {
    expect(() => assertValidRequest('hello')).toThrow(/Invalid applet request/);
  });
});
