import { describe, it, expect } from 'vitest';
import { classifyLairStderr, describeLairFailure } from './lairFailure.js';

describe('classifyLairStderr', () => {
  it('maps EIO, EACCES and EBUSY to keystore-busy', () => {
    expect(classifyLairStderr('ERROR: Error: {"error":"EIO"}').kind).toBe('keystore-busy');
    expect(classifyLairStderr('ERROR: Error: {"error":"EACCES"}').kind).toBe('keystore-busy');
    expect(classifyLairStderr('ERROR: Error: {"error":"EBUSY"}').kind).toBe('keystore-busy');
  });

  it('maps ProcessAlreadyExists to keystore-busy', () => {
    expect(classifyLairStderr('ERROR: Error: {"error":"ProcessAlreadyExists"}').kind).toBe(
      'keystore-busy',
    );
  });

  it('maps InternalSodium to wrong-password', () => {
    expect(classifyLairStderr('ERROR: InternalSodium').kind).toBe('wrong-password');
  });

  it('maps anything else to other with the raw line', () => {
    const f = classifyLairStderr('ERROR: something odd');
    expect(f).toEqual({ kind: 'other', detail: 'ERROR: something odd' });
  });
});

describe('describeLairFailure', () => {
  it('describes keystore-busy with the profile name', () => {
    const text = describeLairFailure({ kind: 'keystore-busy', detail: 'EIO' }, 'work');
    expect(text).toContain('profile "work"');
    expect(text).toContain('another process is using it');
  });

  it('describes keystore-busy for the default profile', () => {
    expect(describeLairFailure({ kind: 'keystore-busy', detail: 'EIO' }, undefined)).toContain(
      'profile "default"',
    );
  });

  it('passes the detail through for other failures', () => {
    expect(describeLairFailure({ kind: 'other', detail: 'boom' }, undefined)).toBe(
      'Failed to launch lair keystore: boom',
    );
    expect(describeLairFailure({ kind: 'exited', detail: 'code 1' }, undefined)).toBe(
      'Failed to launch lair keystore: code 1',
    );
  });
});
