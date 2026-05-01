import { test } from '../fixtures/moss';

test.skip('quit and relaunch with same profile retains group + applet', async ({
  moss: _moss,
}) => {
  // why: relaunch-with-same-profile needs a fixture variant that does NOT delete
  // the profile dir between launches. Add a `keepProfile: true` option to launchMoss
  // when implementing this test.
});
