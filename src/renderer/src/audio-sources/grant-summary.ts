import type { AudioSourceGrantInfo } from '@theweave/moss-types';

/** Copy shared by the chip and the settings list. */
export function formatGrantSummary(
  grant: AudioSourceGrantInfo,
  nowMs: number,
): { title: string; elapsed: string } {
  const totalSeconds = Math.max(0, Math.floor((nowMs - grant.startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    title: `${grant.toolName}: ${grant.label}`,
    elapsed: `${minutes}:${seconds.toString().padStart(2, '0')}`,
  };
}
