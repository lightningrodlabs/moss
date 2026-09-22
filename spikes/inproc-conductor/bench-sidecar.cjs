// Times the sidecar startup path the way Moss runs it: lair-keystore process,
// then holochain process until 'Conductor ready.', then an admin websocket
// connection answering its first list_apps.
//
// Usage: node bench-sidecar.cjs <bench-copy-dir> <lair-bin> <holochain-bin> <moss-node_modules>

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const [root, lairBin, hcBin, nm] = process.argv.slice(2);
const YAML = require(path.join(nm, 'yaml'));
const { AdminWebsocket } = require(path.join(nm, '@holochain/client'));

const password = fs.readFileSync(path.join(root, 'pw'), 'utf8');
const t0 = performance.now();
const mark = (label) => console.log(`${label}: ${(performance.now() - t0).toFixed(0)}ms`);

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForLine(proc, needle, label) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      if (buf.includes(needle)) resolve();
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(d));
    proc.on('exit', (code) => reject(new Error(`${label} exited ${code}`)));
  });
}

(async () => {
  const port = await freePort();
  const cfgPath = path.join(root, 'c', 'conductor-config.yaml');
  const cfg = YAML.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.admin_interfaces[0].driver.port = port;
  const runCfg = path.join(root, 'run-config.yaml');
  fs.writeFileSync(runCfg, YAML.stringify(cfg));

  const t = performance.now();
  const lair = spawn(lairBin, ['server', '-p'], { cwd: path.join(root, 'k') });
  lair.stdin.end(password);
  await waitForLine(lair, '# lair-keystore running #', 'lair');
  mark('lair running');

  const hc = spawn(hcBin, ['-c', runCfg, '-p'], { env: { ...process.env, RUST_LOG: 'warn' } });
  hc.stdin.end(password);
  await waitForLine(hc, 'Conductor ready.', 'holochain');
  mark('conductor ready (stdout)');

  const admin = await AdminWebsocket.connect({
    url: new URL(`ws://127.0.0.1:${port}`),
    wsClientOptions: { origin: 'moss-bench' },
  });
  const apps = await admin.listApps({});
  mark(`first list_apps (${apps.length} apps, ${apps.filter((a) => a.status.type === 'enabled').length} enabled)`);
  console.log(`TOTAL sidecar: ${(performance.now() - t).toFixed(0)}ms`);

  await admin.client.close();
  hc.kill('SIGTERM');
  lair.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  process.exit(0);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
