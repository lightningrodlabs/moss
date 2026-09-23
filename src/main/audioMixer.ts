/**
 * Pure mixing for the audio-source grant port. Every 20 ms the grant takes at
 * most one chunk from each open stream, sums them, and quantises the result to
 * the fixed wire format (mono, 48 kHz, 960 samples, Int16). Queues are bounded
 * so a stalled consumer costs latency, not memory.
 */

export const FRAME_MS = 20;
/** 48 000 Hz × 20 ms, mono. */
export const FRAME_SAMPLES = 960;
/** At most 100 ms of audio may wait per stream before the oldest is discarded. */
export const MAX_BACKLOG_CHUNKS = 5;
/**
 * Extra frames the pump may emit within one tick while a backlog remains, on
 * top of the one it always emits. A `setInterval(FRAME_MS)` timer runs
 * slightly slower than a backend that hands over a chunk every `FRAME_MS`, so
 * queues creep up and `takeFrameInputs` would otherwise discard whole chunks
 * to `MAX_BACKLOG_CHUNKS` well before the backlog is actually large. Bounding
 * the catch-up at 2 keeps added latency within ~40 ms; `MAX_BACKLOG_CHUNKS`
 * stays the hard cap for a pump that cannot keep up at all.
 */
export const PUMP_MAX_FRAMES_PER_TICK = 2;
/**
 * The most owed frames the pump will ever replay after a stall. If the event
 * loop or the grant's timer is starved for seconds, the frame ledger falls that
 * far behind, and replaying the whole debt at `PUMP_MAX_FRAMES_PER_TICK` per
 * tick would put the wire back at twice real time for the length of the
 * recovery — the very over-emission the elapsed-time pump exists to prevent.
 * Five frames matches `MAX_BACKLOG_CHUNKS` and is well inside the 200 ms the
 * Tool's ring can absorb; debt older than that is stale silence, so it is
 * skipped rather than replayed, and the ledger is written forward to match.
 */
export const MAX_CATCHUP_FRAMES = 5;

/**
 * Removes one chunk from the head of every non-empty queue and returns them.
 * Queues longer than `maxBacklog` first lose their oldest entries (counted in
 * `dropped`) so a stream that outpaces the pump cannot accumulate unbounded delay.
 */
export function takeFrameInputs(
  queues: Float32Array[][],
  maxBacklog: number = MAX_BACKLOG_CHUNKS,
): { inputs: Float32Array[]; dropped: number } {
  const inputs: Float32Array[] = [];
  let dropped = 0;
  for (const queue of queues) {
    while (queue.length > maxBacklog) {
      queue.shift();
      dropped += 1;
    }
    const head = queue.shift();
    if (head) inputs.push(head);
  }
  return { inputs, dropped };
}

/** Sums float inputs sample-wise, clamps to [-1, 1] and quantises to Int16. */
export function mixToInt16(
  inputs: readonly Float32Array[],
  frames: number = FRAME_SAMPLES,
): Int16Array {
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (const input of inputs) {
      const s = i < input.length ? input[i] : 0;
      if (Number.isFinite(s)) sum += s;
    }
    if (sum > 1) sum = 1;
    else if (sum < -1) sum = -1;
    out[i] = sum < 0 ? Math.round(sum * 32768) : Math.round(sum * 32767);
  }
  return out;
}
