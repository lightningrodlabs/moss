import { describe, expect, it } from 'vitest';

import { isMossUiMicrophoneRequest } from './mossUiMediaPolicy';

const PACKAGED = 'moss://admin.renderer/index.html';
const DEV = 'http://localhost:5173/';

describe('isMossUiMicrophoneRequest', () => {
  it('accepts an audio-only request from the main window renderer (packaged)', () => {
    expect(
      isMossUiMicrophoneRequest({
        fromMainWindow: true,
        requestingUrl: 'moss://admin.renderer/index.html#foo',
        mainWindowUrl: PACKAGED,
        mediaTypes: ['audio'],
      }),
    ).toBe(true);
  });

  it('accepts an audio-only request from the dev renderer origin', () => {
    expect(
      isMossUiMicrophoneRequest({
        fromMainWindow: true,
        requestingUrl: 'http://localhost:5173/index.html',
        mainWindowUrl: DEV,
        mediaTypes: ['audio'],
      }),
    ).toBe(true);
  });

  it('rejects requests from tool iframes in the main window', () => {
    for (const requestingUrl of ['applet://abc/index.html', 'cross-group://xyz/index.html']) {
      expect(
        isMossUiMicrophoneRequest({
          fromMainWindow: true,
          requestingUrl,
          mainWindowUrl: PACKAGED,
          mediaTypes: ['audio'],
        }),
      ).toBe(false);
    }
  });

  it('rejects requests that include video or name no media type', () => {
    for (const mediaTypes of [['audio', 'video'], ['video'], [], undefined]) {
      expect(
        isMossUiMicrophoneRequest({
          fromMainWindow: true,
          requestingUrl: PACKAGED,
          mainWindowUrl: PACKAGED,
          mediaTypes,
        }),
      ).toBe(false);
    }
  });

  it('rejects requests from other windows', () => {
    expect(
      isMossUiMicrophoneRequest({
        fromMainWindow: false,
        requestingUrl: PACKAGED,
        mainWindowUrl: PACKAGED,
        mediaTypes: ['audio'],
      }),
    ).toBe(false);
  });

  it('rejects unparseable URLs', () => {
    expect(
      isMossUiMicrophoneRequest({
        fromMainWindow: true,
        requestingUrl: 'not a url',
        mainWindowUrl: PACKAGED,
        mediaTypes: ['audio'],
      }),
    ).toBe(false);
  });
});
