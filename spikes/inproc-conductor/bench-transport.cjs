// Pure transport cost: app_info (no WASM, tiny response) over the app
// websocket vs the addon's appRequest, against one in-process conductor.
// Usage: node bench-transport.cjs <addon.node> <data-root> <group.happ> <moss-node_modules>
const path = require('node:path');
const [addonPath, dataRoot, happPath, nm] = process.argv.slice(2);
const { encode, decode } = require(path.join(nm, '@msgpack/msgpack'));
const { AppWebsocket } = require(path.join(nm, '@holochain/client'));
const hc = require(addonPath);
const appId = 'group#transport';
const admin = async (type, value) => {
  const r = decode(await hc.adminRequest(Buffer.from(encode({ type, value }))));
  if (r.type === 'error') throw new Error(JSON.stringify(r.value));
  return r.value;
};
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.floor(p * s.length)];
  return { mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(4), p50: +q(0.5).toFixed(4), p95: +q(0.95).toFixed(4) };
};
(async () => {
  await hc.launch({ dataRoot, passphrase: 'spike-passphrase' });
  await admin('install_app', {
    source: { type: 'path', value: happPath }, installed_app_id: appId, agent_key: null,
    network_seed: `t-${Date.now()}`, ignore_genesis_failure: false, restore_from_dht: false,
    roles_settings: { group: { type: 'provisioned', value: { modifiers: { properties: { progenitor: null } } } } },
  });
  await admin('enable_app', { installed_app_id: appId });
  const { port } = await admin('attach_app_interface', { port: 0, allowed_origins: '*', installed_app_id: null });
  const { token } = await admin('issue_app_authentication_token', { installed_app_id: appId, expiry_seconds: 0, single_use: false });
  const ws = await AppWebsocket.connect({ url: new URL(`ws://127.0.0.1:${port}`), token, wsClientOptions: { origin: 'bench' } });
  const paths = {
    ws: () => ws.appInfo(),
    napi: async () => decode(await hc.appRequest(appId, Buffer.from(encode({ type: 'app_info', value: null })))),
  };
  for (const f of Object.values(paths)) for (let i = 0; i < 200; i++) await f();
  const samples = { ws: [], napi: [] };
  for (let r = 0; r < 10; r++) for (const k of r % 2 ? ['napi', 'ws'] : ['ws', 'napi'])
    for (let i = 0; i < 500; i++) { const t = performance.now(); await paths[k](); samples[k].push(performance.now() - t); }
  for (const k of Object.keys(samples)) console.log(`app_info via ${k.padEnd(5)} (ms, n=${samples[k].length})`, stats(samples[k]));
  await ws.client.close(); await hc.shutdown(); process.exit(0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
