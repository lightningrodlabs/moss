// Boots the in-process conductor, round-trips admin requests through napi, and
// checks that the process holds no listening sockets.
//
// Usage: node roundtrip.cjs <addon.node> <data-root> [msgpack-module-path]
// Under Electron: ELECTRON_RUN_AS_NODE=1 electron roundtrip.cjs ...

const { execSync } = require('node:child_process');
const [addonPath, dataRoot, msgpackPath = '@msgpack/msgpack'] = process.argv.slice(2);
const { encode, decode } = require(msgpackPath);
const hc = require(addonPath);

async function admin(type, value) {
  const t = performance.now();
  const res = decode(await hc.adminRequest(Buffer.from(encode({ type, value }))));
  const ms = (performance.now() - t).toFixed(2);
  if (res.type === 'error') throw new Error(`${type}: ${JSON.stringify(res.value)}`);
  return { res, ms };
}

function listeningSockets() {
  const pid = process.pid;
  const run = (cmd) => {
    try {
      return execSync(cmd, { encoding: 'utf8' })
        .split('\n')
        .filter((l) => l.includes(`pid=${pid},`));
    } catch {
      return [];
    }
  };
  return { tcp: run('ss -Hltnp'), unix: run('ss -Hlxp') };
}

(async () => {
  console.log(`runtime: node ${process.versions.node}, electron ${process.versions.electron ?? '-'}`);
  const timings = await hc.launch(dataRoot, 'spike-passphrase');
  console.log('launch timings (ms):', timings);

  const apps = await admin('list_apps', { status_filter: null });
  console.log(`list_apps -> ${apps.res.type} ${JSON.stringify(apps.res.value)} in ${apps.ms}ms`);

  const key = await admin('generate_agent_pub_key');
  console.log(`generate_agent_pub_key -> ${key.res.type} ${key.res.value.length} bytes in ${key.ms}ms`);

  const socks = listeningSockets();
  console.log(`listening tcp sockets: ${socks.tcp.length}`, socks.tcp);
  console.log(`listening unix sockets: ${socks.unix.length}`, socks.unix);

  const ifaces = await admin('list_app_interfaces');
  console.log(`list_app_interfaces -> ${JSON.stringify(ifaces.res.value)}`);

  await hc.shutdown();
  console.log('shutdown ok');
  process.exit(0);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
