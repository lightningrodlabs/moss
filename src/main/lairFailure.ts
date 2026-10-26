/**
 * Turns lair-keystore's stderr into something Moss can act on. Lair reports OS
 * errors as bare errno names (`{"error":"EIO"}`), and on Windows that name is a
 * mislabeled ERROR_ACCESS_DENIED from CreateNamedPipe: another process still
 * holds this keystore's pipe. Moss can recover from that; it cannot from the rest.
 */

export type LairFailureKind = 'wrong-password' | 'keystore-busy' | 'exited' | 'other';

export interface LairFailure {
  kind: LairFailureKind;
  detail: string;
}

const KEYSTORE_BUSY = /"error":"(EIO|EACCES|EBUSY)"|ProcessAlreadyExists/;

export function classifyLairStderr(line: string): LairFailure {
  if (line.includes('InternalSodium')) return { kind: 'wrong-password', detail: line };
  if (KEYSTORE_BUSY.test(line)) return { kind: 'keystore-busy', detail: line };
  return { kind: 'other', detail: line };
}

/** The sentence shown on the splash screen when the launch gives up. */
export function describeLairFailure(failure: LairFailure, profile: string | undefined): string {
  if (failure.kind === 'keystore-busy') {
    return `Moss could not open the keystore for profile "${profile ?? 'default'}" because another process is using it. This is usually a lair-keystore, holochain or Moss process left over from an earlier session. Stop it and retry, or restart your computer.`;
  }
  return `Failed to launch lair keystore: ${failure.detail}`;
}
