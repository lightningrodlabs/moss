import { describe, expect, it } from 'vitest';
import type { AppWebsocket } from '@holochain/client';

import { applyStickyAuthToken } from './app-websocket.js';

function fakeAppWs(token: unknown): AppWebsocket {
  return { client: { authenticationToken: token } } as unknown as AppWebsocket;
}

describe('applyStickyAuthToken', () => {
  it('keeps the current token readable', () => {
    const appWs = fakeAppWs('token-1');
    applyStickyAuthToken(appWs);
    expect((appWs.client as unknown as { authenticationToken: unknown }).authenticationToken).toBe(
      'token-1',
    );
  });

  it('ignores an undefined write so a failed reconnect cannot clear the token', () => {
    const appWs = fakeAppWs('token-1');
    applyStickyAuthToken(appWs);
    const client = appWs.client as unknown as { authenticationToken: unknown };
    client.authenticationToken = undefined;
    expect(client.authenticationToken).toBe('token-1');
  });

  it('accepts a real token refresh', () => {
    const appWs = fakeAppWs('token-1');
    applyStickyAuthToken(appWs);
    const client = appWs.client as unknown as { authenticationToken: unknown };
    client.authenticationToken = 'token-2';
    expect(client.authenticationToken).toBe('token-2');
  });
});
