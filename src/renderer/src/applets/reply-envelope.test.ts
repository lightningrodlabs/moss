import { describe, it, expect } from 'vitest';
import { replyWithError } from './reply-envelope';

function nextMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.onmessage = (m) => {
      port.close();
      resolve(m.data);
    };
  });
}

describe('replyWithError', () => {
  it('sends an error envelope on the reply port, so the applet promise rejects', async () => {
    const channel = new MessageChannel();
    const received = nextMessage(channel.port1);
    replyWithError([channel.port2], new Error('Unrecognized iframe origin: https://evil.example'));
    expect(await received).toEqual({
      type: 'error',
      error: 'Unrecognized iframe origin: https://evil.example',
    });
    channel.port2.close();
  });

  it('does nothing when the message carries no reply port', () => {
    expect(() => replyWithError([], new Error('x'))).not.toThrow();
  });
});
