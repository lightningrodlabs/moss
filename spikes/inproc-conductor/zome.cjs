// Installs group.happ into a fresh in-process conductor the way Moss does,
// then makes a signed zome call through the App API.
//
// Usage: node zome.cjs <addon.node> <data-root> <group.happ> [msgpack-module-path]

const [addonPath, dataRoot, happPath, msgpackPath = '@msgpack/msgpack'] = process.argv.slice(2);
const { encode, decode } = require(msgpackPath);
const hc = require(addonPath);

async function timed(label, fn) {
  const t = performance.now();
  const out = await fn();
  console.log(`${label}: ${(performance.now() - t).toFixed(1)}ms`);
  return out;
}

async function admin(type, value) {
  const res = decode(await hc.adminRequest(Buffer.from(encode({ type, value }))));
  if (res.type === 'error') throw new Error(`${type}: ${JSON.stringify(res.value)}`);
  return res.value;
}

(async () => {
  const timings = await hc.launch({ dataRoot, passphrase: 'spike-passphrase' });
  console.log('launch timings (ms):', timings);

  const appId = 'group#spike';
  await timed('install_app (incl. wasm compile + genesis)', () =>
    admin('install_app', {
      source: { type: 'path', value: happPath },
      installed_app_id: appId,
      agent_key: null,
      network_seed: `spike-${Date.now()}`,
      roles_settings: {
        group: { type: 'provisioned', value: { modifiers: { properties: { progenitor: null } } } },
      },
      ignore_genesis_failure: false,
      restore_from_dht: false,
    }),
  );
  await timed('enable_app', () => admin('enable_app', { installed_app_id: appId }));

  for (let i = 0; i < 3; i++) {
    const out = await timed(`call_zome group/get_my_joined_applets #${i + 1}`, () =>
      hc.callZome(appId, 'group', 'group', 'get_my_joined_applets', Buffer.from(encode(null))),
    );
    console.log('  ->', JSON.stringify(decode(out)));
  }

  await hc.shutdown();
  console.log('shutdown ok');
  process.exit(0);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
