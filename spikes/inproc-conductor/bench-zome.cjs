// Websocket vs direct zome-call latency against ONE in-process conductor.
// The same cell, the same call and the same JS signing (@holochain/client
// signZomeCall with an assigned cap grant) go over:
//   ws        - an attached app websocket (AppWebsocket.callZome)
//   napi      - the addon's appRequest with the identical signed request
//   napi-rust - the addon's callZome, signed host-side by the in-proc lair
// so the ws/napi difference is transport only.
//
// Usage: node bench-zome.cjs <addon.node> <data-root> <group.happ> <moss-node_modules>

const path = require('node:path');
const [addonPath, dataRoot, happPath, nm] = process.argv.slice(2);
const { encode, decode } = require(path.join(nm, '@msgpack/msgpack'));
const hcClient = require(path.join(nm, '@holochain/client'));
const hc = require(addonPath);

const ROUNDS = 5;
const PER_ROUND = 200;
const appId = 'group#bench';

async function admin(type, value) {
  const res = decode(await hc.adminRequest(Buffer.from(encode({ type, value }))));
  if (res.type === 'error') throw new Error(`${type}: ${JSON.stringify(res.value)}`);
  return res.value;
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, mean: +mean.toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3) };
}

(async () => {
  await hc.launch({ dataRoot, passphrase: 'spike-passphrase' });
  await admin('install_app', {
    source: { type: 'path', value: happPath },
    installed_app_id: appId,
    agent_key: null,
    network_seed: `bench-${Date.now()}`,
    roles_settings: {
      group: { type: 'provisioned', value: { modifiers: { properties: { progenitor: null } } } },
    },
    ignore_genesis_failure: false,
    restore_from_dht: false,
  });
  const appInfo = await admin('enable_app', { installed_app_id: appId });
  const cellId = appInfo.cell_info.group[0].value.cell_id;

  // JS-side signing credentials, as @holochain/client uses them.
  const [keyPair, signingKey] = await hcClient.generateSigningKeyPair();
  const capSecret = await hcClient.randomCapSecret();
  await admin('grant_zome_call_capability', {
    cell_id: cellId,
    cap_grant: {
      tag: 'bench',
      functions: { type: 'all' },
      access: { type: 'assigned', value: { secret: capSecret, assignees: [signingKey] } },
    },
  });
  hcClient.setSigningCredentials(cellId, { capSecret, keyPair, signingKey });

  const { port } = await admin('attach_app_interface', {
    port: 0,
    allowed_origins: '*',
    installed_app_id: null,
  });
  const { token } = await admin('issue_app_authentication_token', {
    installed_app_id: appId,
    expiry_seconds: 0,
    single_use: false,
  });
  const ws = await hcClient.AppWebsocket.connect({
    url: new URL(`ws://127.0.0.1:${port}`),
    token,
    wsClientOptions: { origin: 'bench' },
  });

  const bigApplet = {
    permission_hash: null,
    custom_name: 'bench',
    description: 'x'.repeat(100_000),
    sha256_happ: '0',
    sha256_ui: null,
    sha256_webhapp: null,
    distribution_info: '{}',
    meta_data: null,
    network_seed: null,
    properties: {},
  };
  const calls = {
    'get_my_joined_applets (tiny)': { fn_name: 'get_my_joined_applets', payload: null },
    'hash_applet (100 KB in)': { fn_name: 'hash_applet', payload: bigApplet },
  };

  const viaWs = (c) => ws.callZome({ cell_id: cellId, zome_name: 'group', ...c });
  const viaNapi = async (c) => {
    const signed = await hcClient.signZomeCall({
      cell_id: cellId,
      zome_name: 'group',
      provenance: cellId[1],
      ...c,
    });
    const res = decode(
      await hc.appRequest(appId, Buffer.from(encode({ type: 'call_zome', value: signed }))),
    );
    if (res.type !== 'zome_called') throw new Error(JSON.stringify(res));
    return decode(res.value);
  };
  const viaNapiRust = async (c) =>
    decode(await hc.callZome(appId, 'group', 'group', c.fn_name, Buffer.from(encode(c.payload))));
  const signOnly = (c) =>
    hcClient.signZomeCall({ cell_id: cellId, zome_name: 'group', provenance: cellId[1], ...c });
  const paths = { ws: viaWs, napi: viaNapi, 'napi-rust': viaNapiRust, 'sign only (JS)': signOnly };

  // Warm-up: runs init and compiles each path's first call.
  for (const c of Object.values(calls)) for (const f of Object.values(paths)) await f(c);

  // Sanity: every path returns the same result.
  for (const [label, c] of Object.entries(calls)) {
    const outs = await Promise.all([viaWs(c), viaNapi(c), viaNapiRust(c)].map((p) => p));
    const same = outs.every((o) => JSON.stringify(o) === JSON.stringify(outs[0]));
    console.log(`${label}: results identical across paths: ${same}`);
  }

  for (const [label, c] of Object.entries(calls)) {
    const samples = Object.fromEntries(Object.keys(paths).map((k) => [k, []]));
    const order = Object.keys(paths);
    for (let r = 0; r < ROUNDS; r++) {
      // Rotate path order each round so no path always runs first.
      const rotated = order.slice(r % order.length).concat(order.slice(0, r % order.length));
      for (const k of rotated) {
        for (let i = 0; i < PER_ROUND; i++) {
          const t = performance.now();
          await paths[k](c);
          samples[k].push(performance.now() - t);
        }
      }
    }
    console.log(`\n== ${label} (ms, sequential calls)`);
    for (const k of order) console.log(`  ${k.padEnd(16)}`, stats(samples[k]));
  }

  await ws.client.close();
  await hc.shutdown();
  process.exit(0);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
