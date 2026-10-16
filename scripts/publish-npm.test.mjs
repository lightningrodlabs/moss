import { test } from 'node:test';
import assert from 'node:assert/strict';

const { distTagFor, compareReleases, resolveDistTag, publishOrder } = await import(
  './publish-npm.mjs'
);

test('prerelease goes to next', () => {
  assert.equal(distTagFor('0.7.0-rc.1', '0.7.0-dev.5'), 'next');
});

test('newer release goes to latest', () => {
  assert.equal(distTagFor('0.7.0', '0.6.2'), 'latest');
});

test('first publish goes to latest', () => {
  assert.equal(distTagFor('0.1.0', null), 'latest');
});

test('older line goes to release-major.minor', () => {
  assert.equal(distTagFor('0.6.5', '0.7.0'), 'release-0.6');
});

test('compares numerically, not lexically', () => {
  assert.ok(compareReleases('0.10.0', '0.9.0') > 0);
});

test('rejects non-semver', () => {
  assert.throws(() => distTagFor('latest', null));
});

test('an explicit dist-tag wins over the computed one', () => {
  assert.equal(resolveDistTag('latest', '0.7.0-rc.1', '0.7.0-dev.5'), 'latest');
});

test('an empty or auto dist-tag falls back to the computed one', () => {
  assert.equal(resolveDistTag('', '0.7.0-rc.1', '0.7.0-dev.5'), 'next');
  assert.equal(resolveDistTag('auto', '0.7.0-rc.1', '0.7.0-dev.5'), 'next');
});

test('publishes a package only after the siblings it depends on', () => {
  const packages = [
    { name: '@theweave/cli', deps: ['@theweave/api', '@theweave/utils'] },
    { name: '@theweave/utils', deps: ['@theweave/api', '@theweave/moss-types'] },
    { name: '@theweave/moss-types', deps: ['@theweave/api'] },
    { name: '@theweave/api', deps: [] },
  ];
  assert.deepEqual(
    publishOrder(packages).map((p) => p.name),
    ['@theweave/api', '@theweave/moss-types', '@theweave/utils', '@theweave/cli'],
  );
});

test('rejects a dependency cycle among the packages', () => {
  assert.throws(() =>
    publishOrder([
      { name: 'a', deps: ['b'] },
      { name: 'b', deps: ['a'] },
    ]),
  );
});

test('a release replaces a prerelease that holds latest', () => {
  // Moss has published its dev builds under latest, e.g. 0.7.0-dev.5.
  assert.equal(distTagFor('0.6.9', '0.7.0-dev.5'), 'latest');
});
