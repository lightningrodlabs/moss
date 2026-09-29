import { describe, it, expect } from 'vitest';
import { hostTimeoutMessage } from './host-timeout';

describe('hostTimeoutMessage', () => {
  it('points at the Tool handler when the iframe reported ready', () => {
    const text = hostTimeoutMessage('search', 'uhCAk', 20000, 'reported');
    expect(text).toContain("postMessage 'search' to applet uhCAk timed out after 20000ms");
    expect(text).toContain("stalled inside the Tool's own handler");
  });

  it('does not claim readiness when the iframe was only found in the DOM', () => {
    const text = hostTimeoutMessage('search', 'uhCAk', 20000, 'assumed');
    expect(text).not.toContain('reported that it can answer');
    expect(text).toContain('never reported that it was ready');
  });
});
