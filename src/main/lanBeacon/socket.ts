import dgram from 'node:dgram';
import os from 'node:os';

/**
 * An administratively scoped multicast group and a port of our own. TTL 1 keeps
 * every beacon on the local link regardless of scope.
 */
export const LAN_INVITE_MULTICAST_ADDRESS = '239.255.76.67';
export const LAN_INVITE_PORT = 47654;

/**
 * Where one beacon goes. A multi-homed machine cannot rely on the kernel to
 * pick the right interface for a multicast datagram — with a VPN up it will
 * often pick the tunnel, and the beacon never reaches the LAN at all. So the
 * multicast copy is sent once per interface, pinned to that interface, and the
 * directed broadcast alongside it for access points that drop multicast.
 */
export function broadcastPlan(
  interfaces: readonly Ipv4Interface[],
): { via: string; address: string }[] {
  const plan: { via: string; address: string }[] = [];
  for (const iface of interfaces) {
    plan.push({ via: iface.address, address: LAN_INVITE_MULTICAST_ADDRESS });
    plan.push({ via: iface.address, address: iface.broadcast });
  }
  return plan;
}

export type DatagramHandler = (
  payload: Uint8Array,
  remoteAddress: string,
  remotePort: number,
) => void;

export type BeaconSocket = {
  broadcast(payload: Uint8Array): void;
  unicast(payload: Uint8Array, address: string, port: number): void;
  joinedInterfaces(): string[];
  close(): Promise<void>;
};

export type Ipv4Interface = { name: string; address: string; broadcast: string };

export async function openBeaconSocket(onDatagram: DatagramHandler): Promise<BeaconSocket> {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const joined: string[] = [];
  let closed = false;
  let pending: Promise<void> = Promise.resolve();

  socket.on('message', (message, rinfo) => {
    onDatagram(new Uint8Array(message), rinfo.address, rinfo.port);
  });
  // A hostile or merely noisy network should not be able to take the app down,
  // but a discarded error here is the only trace of why the socket went quiet.
  socket.on('error', (error) => {
    console.warn(`[lan-beacon] socket error: ${error}`);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(LAN_INVITE_PORT, () => {
      socket.removeListener('error', reject);
      resolve();
    });
  });

  socket.setBroadcast(true);
  socket.setMulticastTTL(1);
  // On so that several agents on one developer machine can find each other.
  socket.setMulticastLoopback(true);

  // Joining on a single OS-chosen interface is the classic failure on machines
  // with a VPN, a docker bridge, or both ethernet and wifi up.
  for (const iface of ipv4Interfaces()) {
    try {
      socket.addMembership(LAN_INVITE_MULTICAST_ADDRESS, iface.address);
      joined.push(iface.name);
    } catch (error) {
      // An interface that refuses the group is not a reason to give up on the rest,
      // but if every interface ends up here, joinedInterfaces() must explain why.
      console.warn(`[lan-beacon] ${iface.name} refused to join the multicast group: ${error}`);
    }
  }

  return {
    broadcast(payload) {
      if (closed) return;
      const plan = broadcastPlan(ipv4Interfaces());
      // setMulticastInterface applies to whatever is sent next, and dgram
      // sends complete asynchronously, so the datagrams of one beacon are
      // sent one at a time — overlapping them would send every copy out
      // whichever interface happened to be set last.
      pending = pending
        .then(async () => {
          for (const hop of plan) {
            if (closed) return;
            try {
              socket.setMulticastInterface(hop.via);
            } catch (e) {
              console.warn(`[lan-beacon] could not send via ${hop.via}: ${e}`);
            }
            await sendOnce(socket, payload, hop.address, LAN_INVITE_PORT);
          }
        })
        .catch((e) => console.warn(`[lan-beacon] broadcast failed: ${e}`));
    },
    unicast(payload, address, port) {
      if (closed) return;
      send(socket, payload, address, port);
    },
    joinedInterfaces: () => [...joined],
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve) => socket.close(() => resolve()));
    },
  };
}

function sendOnce(
  socket: dgram.Socket,
  payload: Uint8Array,
  address: string,
  port: number,
): Promise<void> {
  return new Promise((resolve) => {
    socket.send(payload, port, address, (error) => {
      if (error) console.warn(`[lan-beacon] send to ${address}:${port} failed: ${error}`);
      resolve();
    });
  });
}

function send(socket: dgram.Socket, payload: Uint8Array, address: string, port: number): void {
  socket.send(payload, port, address, (error) => {
    if (error) {
      console.warn(`[lan-beacon] send to ${address}:${port} failed: ${error}`);
    }
  });
}

function ipv4Interfaces(): Ipv4Interface[] {
  const found: Ipv4Interface[] = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      found.push({
        name,
        address: address.address,
        broadcast: broadcastAddress(address.address, address.netmask),
      });
    }
  }
  return found;
}

function broadcastAddress(address: string, netmask: string): string {
  const host = address.split('.').map(Number);
  const mask = netmask.split('.').map(Number);
  return host.map((octet, i) => (octet & mask[i]) | (~mask[i] & 0xff)).join('.');
}
