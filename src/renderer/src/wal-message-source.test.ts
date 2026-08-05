import { describe, it, expect } from 'vitest';
import { deriveWalMessageSource } from './wal-message-source';
import type { IframeKind } from '@theweave/api';

const APPLET_HASH = new Uint8Array([1, 2, 3]);
const IFRAME_GROUP = new Uint8Array([9, 9, 9]);
const FALLBACK_GROUP = new Uint8Array([7, 7, 7]);

describe('deriveWalMessageSource', () => {
  it('applet iframe keeps its own declared groupHash', () => {
    const kind: IframeKind = {
      type: 'applet',
      appletHash: APPLET_HASH,
      groupHash: IFRAME_GROUP,
      subType: 'main',
    };
    expect(deriveWalMessageSource(kind, 'asset', FALLBACK_GROUP)).toEqual({
      type: 'applet',
      appletHash: APPLET_HASH,
      groupHash: IFRAME_GROUP,
      subType: 'asset',
    });
  });

  it('applet iframe with no declared groupHash falls back to the WAL window group', () => {
    const kind: IframeKind = {
      type: 'applet',
      appletHash: APPLET_HASH,
      groupHash: null,
      subType: 'main',
    };
    expect(deriveWalMessageSource(kind, 'main', FALLBACK_GROUP)).toEqual({
      type: 'applet',
      appletHash: APPLET_HASH,
      groupHash: FALLBACK_GROUP,
      subType: 'main',
    });
  });

  it('cross-group iframe carries the tool id and never a groupHash', () => {
    const kind: IframeKind = {
      type: 'cross-group',
      toolCompatibilityId: 'tool-xyz',
      subType: 'main',
    };
    expect(deriveWalMessageSource(kind, 'creatable', FALLBACK_GROUP)).toEqual({
      type: 'cross-group',
      toolCompatibilityId: 'tool-xyz',
      subType: 'creatable',
    });
  });

  it('uses the passed subType, not the identity subType', () => {
    const kind: IframeKind = {
      type: 'applet',
      appletHash: APPLET_HASH,
      groupHash: IFRAME_GROUP,
      subType: 'main',
    };
    expect(deriveWalMessageSource(kind, 'block', FALLBACK_GROUP).subType).toBe('block');
  });
});
