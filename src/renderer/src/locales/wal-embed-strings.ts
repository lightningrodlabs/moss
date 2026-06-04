/**
 * Localization anchor for strings used by `<wal-embed>` (in @theweave/elements).
 *
 * lit-localize's extractor only follows the renderer's TS program; it can't see
 * source inside libs/elements. Referencing each string here with `msg()` makes
 * the extractor pick it up and produce xliff entries. At runtime the same
 * source text resolves to the same message ID, so wal-embed picks up the
 * translation transparently — the dummy reads below are never used.
 */
import { msg } from '@lit/localize';

const _WAL_EMBED_STRINGS = [
  msg('It may not yet have been synchronized from other peers.'),
  msg('This asset cannot be loaded until the Tool that created it is activated.'),
];

void _WAL_EMBED_STRINGS;
