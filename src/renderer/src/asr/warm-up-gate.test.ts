import { describe, expect, it } from 'vitest';
import { warmUpRefusal } from './warm-up-gate';

describe('warmUpRefusal', () => {
  it('allows a warm-up when Transcription is on and the Tool holds consent', () => {
    expect(warmUpRefusal({ transcriptionEnabled: true, consent: 'granted' })).toBeUndefined();
  });

  it('refuses when Transcription is off, whatever the consent', () => {
    expect(warmUpRefusal({ transcriptionEnabled: false, consent: 'granted' })).toMatch(/disabled/);
  });

  it('refuses a Tool the user never allowed to transcribe', () => {
    expect(warmUpRefusal({ transcriptionEnabled: true, consent: undefined })).toMatch(/consent/);
  });

  it('refuses a Tool the user denied', () => {
    expect(warmUpRefusal({ transcriptionEnabled: true, consent: 'denied' })).toMatch(/consent/);
  });
});
