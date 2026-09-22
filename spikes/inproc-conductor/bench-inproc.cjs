// Times the in-process startup path on a Moss profile copy: in-proc lair +
// conductor build, then the first list_apps through napi.
//
// Usage: node bench-inproc.cjs <addon.node> <bench-copy-dir> <msgpack-module-path>

const fs = require('node:fs');
const path = require('node:path');
const [addonPath, root, msgpackPath] = process.argv.slice(2);
const { encode, decode } = require(msgpackPath);
const hc = require(addonPath);

(async () => {
  const t = performance.now();
  const timings = await hc.launch({
    dataRoot: path.join(root, 'c'),
    lairRoot: path.join(root, 'k'),
    passphrase: fs.readFileSync(path.join(root, 'pw'), 'utf8'),
    conductorConfigPath: path.join(root, 'c', 'conductor-config.yaml'),
  });
  console.log(
    `lair: ${timings.lairMs.toFixed(0)}ms, conductor build: ${timings.conductorBuildMs.toFixed(0)}ms`,
  );
  const res = decode(
    await hc.adminRequest(Buffer.from(encode({ type: 'list_apps', value: { status_filter: null } }))),
  );
  if (res.type === 'error') throw new Error(JSON.stringify(res.value));
  const apps = res.value;
  console.log(
    `first list_apps (${apps.length} apps, ${apps.filter((a) => a.status.type === 'enabled').length} enabled)`,
  );
  console.log(`TOTAL inproc: ${(performance.now() - t).toFixed(0)}ms`);
  await hc.shutdown();
  process.exit(0);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
