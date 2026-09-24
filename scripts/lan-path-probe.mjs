#!/usr/bin/env node
// Tests whether this network carries the traffic the LAN invite feature needs,
// without involving Moss at all. Run `listen` on one machine and `send` on the
// other; each datagram says how it was addressed, so the output names exactly
// which delivery methods this network passes and which it drops.
//
//   node scripts/lan-path-probe.mjs listen
//   node scripts/lan-path-probe.mjs send [unicast-ip-of-the-listening-machine]

import dgram from 'dgram';
import os from 'os';

const GROUP = '239.255.76.67';
const PORT = 47654;

function ipv4Interfaces() {
  const found = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const host = address.address.split('.').map(Number);
      const mask = address.netmask.split('.').map(Number);
      const broadcast = host.map((o, i) => (o & mask[i]) | (~mask[i] & 0xff)).join('.');
      found.push({ name, address: address.address, broadcast });
    }
  }
  return found;
}

const mode = process.argv[2];
const target = process.argv[3];
const interfaces = ipv4Interfaces();
console.log('interfaces:', interfaces.map((i) => `${i.name} ${i.address} bcast=${i.broadcast}`).join(' | '));

if (mode === 'listen') {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const counts = {};
  socket.on('message', (msg, rinfo) => {
    // Moss's own beacons use this same group and port, so they land here too.
    // They are msgpack, not text: show them as bytes rather than mojibake.
    const text = msg.toString();
    const printable = /^[\x20-\x7e]*$/.test(text);
    const kind = printable
      ? text.slice(0, 40)
      : `MOSS BEACON? ${msg.length}B ${msg.subarray(0, 8).toString('hex')}`;
    counts[kind] = (counts[kind] ?? 0) + 1;
    console.log(`${new Date().toISOString().slice(11, 19)}  from ${rinfo.address}  ${kind}  (total ${counts[kind]})`);
  });
  socket.on('error', (e) => console.error('socket error:', e.message));
  socket.bind(PORT, () => {
    socket.setBroadcast(true);
    for (const iface of interfaces) {
      try {
        socket.addMembership(GROUP, iface.address);
        console.log(`joined ${GROUP} on ${iface.name}`);
      } catch (e) {
        console.log(`could NOT join on ${iface.name}: ${e.message}`);
      }
    }
    console.log(`listening on ${PORT}. Nothing below this line means nothing arrived.`);
  });
} else if (mode === 'send') {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.bind(0, () => {
    socket.setBroadcast(true);
    socket.setMulticastTTL(1);
    let n = 0;
    setInterval(() => {
      n++;
      for (const iface of interfaces) {
        try {
          socket.setMulticastInterface(iface.address);
        } catch {}
        socket.send(`multicast via ${iface.name} #${n}`, PORT, GROUP);
        socket.send(`subnet-broadcast via ${iface.name} #${n}`, PORT, iface.broadcast);
      }
      socket.send(`limited-broadcast #${n}`, PORT, '255.255.255.255');
      if (target) socket.send(`unicast #${n}`, PORT, target);
      console.log(`sent round ${n}${target ? ` (incl. unicast to ${target})` : ''}`);
    }, 2000);
  });
} else if (mode === 'sendmoss') {
  // Sends exactly the way Moss does: from the bound beacon port, with the
  // group joined and loopback on, one pinned multicast plus one directed
  // broadcast per interface, every 3s — and times each datagram, so a hop
  // that errors or stalls names itself.
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', (e) => console.error('socket error:', e.message));
  socket.bind(PORT, () => {
    socket.setBroadcast(true);
    socket.setMulticastTTL(1);
    socket.setMulticastLoopback(true);
    for (const iface of interfaces) {
      try {
        socket.addMembership(GROUP, iface.address);
        console.log(`joined ${GROUP} on ${iface.name}`);
      } catch (e) {
        console.log(`could NOT join on ${iface.name}: ${e.message}`);
      }
    }
    const plan = [];
    for (const iface of interfaces) {
      plan.push({ via: iface.address, to: GROUP, label: `mcast/${iface.name}` });
      plan.push({ via: iface.address, to: iface.broadcast, label: `bcast/${iface.name}` });
    }
    let round = 0;
    let queued = 0;
    let chain = Promise.resolve();
    setInterval(() => {
      round++;
      queued++;
      const mine = round;
      chain = chain.then(async () => {
        const started = Date.now();
        for (const hop of plan) {
          const at = Date.now();
          try {
            socket.setMulticastInterface(hop.via);
          } catch (e) {
            console.log(`  ${hop.label}: setMulticastInterface failed: ${e.message}`);
          }
          await new Promise((resolve) => {
            socket.send(Buffer.from(`moss-style #${mine} ${hop.label}`), PORT, hop.to, (err) => {
              console.log(
                `#${mine} ${hop.label.padEnd(20)} -> ${String(hop.to).padEnd(16)} ${Date.now() - at}ms${err ? '  ERROR ' + err.message : ''}`,
              );
              resolve();
            });
          });
        }
        queued--;
        console.log(`#${mine} round took ${Date.now() - started}ms, ${queued} still queued`);
      });
    }, 3000);
  });
} else {
  console.log('usage: lan-path-probe.mjs listen | send [unicast-ip] | sendmoss');
  process.exit(1);
}
