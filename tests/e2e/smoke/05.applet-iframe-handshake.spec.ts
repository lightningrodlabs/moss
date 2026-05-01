import { test } from '../fixtures/moss';

test.skip('applet iframe loads and WeaveClient handshake completes', async ({ moss: _moss }) => {
  // why: depends on smoke #4 + a deterministic [data-weave-ready] marker on the
  // example applet's root element post-handshake. Add that marker to the example
  // applet first; then implement here.
});
