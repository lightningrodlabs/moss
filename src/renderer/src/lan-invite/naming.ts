import { ADJECTIVES, NOUNS } from './wordlist.js';

/** Each list holds 2^8 words, so a name is one byte of digest per half. */
const BITS_PER_WORD = 8;

/**
 * The name two people say to each other to agree on which beacon is whose.
 *
 * Two words out of 2048 is 22 bits, which is not enough to make grinding a
 * chosen name expensive — and deliberately so. What protects the exchange is
 * that a name held by two live beacons is shown as ambiguous and refused at
 * seal time, so a successful grind buys a visible denial of service rather
 * than someone else's invite. Given that, the length is a usability question,
 * and two words are what people can hold in their head and say across a table.
 * Accidental collisions among the handful of people in a room stay negligible.
 *
 * Deriving it from the key rather than choosing it at random means nobody can
 * claim a name they do not hold the key for without grinding a hash collision,
 * and it keeps the name off the wire entirely.
 */
export async function nameFromPublicKey(rawPublicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new Uint8Array(rawPublicKey)),
  );
  const adjective = ADJECTIVES[wordIndex(digest, 0)];
  const noun = NOUNS[wordIndex(digest, BITS_PER_WORD)];
  return `${capitalise(adjective)} ${capitalise(noun)}`;
}

/** Reads `BITS_PER_WORD` bits out of the digest starting at `bitOffset`. */
function wordIndex(digest: Uint8Array, bitOffset: number): number {
  let value = 0;
  for (let bit = 0; bit < BITS_PER_WORD; bit++) {
    const absolute = bitOffset + bit;
    const byte = digest[absolute >> 3];
    value = (value << 1) | ((byte >> (7 - (absolute & 7))) & 1);
  }
  return value;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Names heard more than once. A duplicate is shown and blocked rather than
 * silently picked, so that a ground collision costs an attacker a visible denial
 * of service instead of buying them someone else's invite.
 */
export function duplicateNames(names: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return duplicates;
}
