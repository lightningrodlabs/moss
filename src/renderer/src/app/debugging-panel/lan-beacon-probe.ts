/** The slice of the preload bridge the probe needs, named so a test can stand in for it. */
export type LanBeaconProbeApi = {
  lanBeaconSetListening: (listening: boolean) => Promise<void>;
  lanBeaconDiagnostics: () => Promise<LanBeaconReading>;
};

export type LanBeaconReading = {
  bound: boolean;
  interfaces: string[];
  advertising: boolean;
  advertisementId: number | undefined;
  sent: number;
  received: number;
  dropped: number;
};

export type LanBeaconProbeOptions = {
  api: LanBeaconProbeApi;
  onReading: (reading: LanBeaconReading) => void;
  intervalMs?: number;
};

export type LanBeaconProbe = {
  start(): Promise<void>;
  stop(): void;
};

const POLL_INTERVAL_MS = 2000;

/**
 * Reads the beacon diagnostics for the debugging panel and nothing else.
 *
 * It holds a listen claim while it runs, because otherwise the panel would
 * report `bound: false` whenever no dialog happened to be open — a reading the
 * field recipe teaches testers to read as an OS-level problem. What it must not
 * do is own a `LanInviteSession`: a session carries a presence engine, ephemeral
 * keys and, decisively, a `close()` that stops an advertisement. There is one
 * advertisement slot for the whole process, so a panel closing a session it
 * never advertised through would silence a member's running broadcast.
 */
export function createLanBeaconProbe(options: LanBeaconProbeOptions): LanBeaconProbe {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  let listening = false;
  let poll: ReturnType<typeof setInterval> | undefined;

  return {
    async start() {
      if (listening) return;
      listening = true;
      await options.api.lanBeaconSetListening(true);
      poll = setInterval(async () => {
        try {
          options.onReading(await options.api.lanBeaconDiagnostics());
        } catch (e) {
          console.error('Failed to read LAN beacon diagnostics:', e);
        }
      }, intervalMs);
    },
    stop() {
      if (poll !== undefined) {
        clearInterval(poll);
        poll = undefined;
      }
      if (!listening) return;
      listening = false;
      void options.api
        .lanBeaconSetListening(false)
        .catch((e) => console.error('Failed to release the LAN beacon listen claim:', e));
    },
  };
}
