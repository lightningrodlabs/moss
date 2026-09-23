import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { AppletToParentRequest } from './validationSchemas';

describe('AppletToParentRequest schema: request-audio-sources', () => {
  it('accepts the bare request', () => {
    expect(Value.Check(AppletToParentRequest, { type: 'request-audio-sources' })).toBe(true);
  });

  it('rejects extra properties (the request carries nothing; identity comes from the iframe origin)', () => {
    expect(Value.Check(AppletToParentRequest, { type: 'request-audio-sources', pid: 5 })).toBe(false);
  });

  it('still accepts a neighbouring variant', () => {
    expect(Value.Check(AppletToParentRequest, { type: 'user-select-screen' })).toBe(true);
  });
});
