/**
 * Semantic tree definitions for Posts.
 *
 * Defines POST, TITLE, and CONTENT symbols so other tools can subscribe
 * to post data using semtrex patterns like `/POST/(TITLE,CONTENT)`.
 */

import {
  createBaseSemTable,
  newRoot,
  newStr,
  treeToJSON,
  STRUCTURES,
  type SemNodeJSON,
} from 'ceptr-js';
import type { SemTableDefsJSON } from '@theweave/api';

/** Definitions to register in the shared vocabulary. */
export const POST_DEFS: SemTableDefsJSON = {
  symbols: [
    { label: 'POST', structureLabel: 'TREE' },
    { label: 'TITLE', structureLabel: 'CSTRING' },
    { label: 'CONTENT', structureLabel: 'CSTRING' },
  ],
  structures: [],
};

/** Semtrex pattern matching a POST with TITLE and CONTENT children. */
export const POST_PATTERN = '/POST/(TITLE,CONTENT)';

/** Build a POST semantic tree from title and content strings. */
export function buildPostTree(title: string, content: string): SemNodeJSON {
  const sem = createBaseSemTable();
  const POST = sem.defineSymbol(1, STRUCTURES.TREE, 'POST');
  const TITLE = sem.defineSymbol(1, STRUCTURES.CSTRING, 'TITLE');
  const CONTENT = sem.defineSymbol(1, STRUCTURES.CSTRING, 'CONTENT');

  const post = newRoot(POST);
  newStr(post, TITLE, title);
  newStr(post, CONTENT, content);
  return treeToJSON(post, sem) as SemNodeJSON;
}
