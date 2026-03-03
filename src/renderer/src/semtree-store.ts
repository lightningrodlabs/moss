/**
 * SemTreeStore — renderer-side semantic tree pub/sub store.
 *
 * Manages a shared vocabulary (SemTable), a buffer of published trees,
 * and subscriptions with semtrex pattern matching.
 */

import {
  SemTable,
  createBaseSemTable,
  parseSemtrex,
  match,
  treeFromJSON,
  STRUCTURES,
  type SemNode,
  type SemNodeJSON,
} from 'ceptr-js';
import type { SemTableDefsJSON, SemTreeDataEvent, AppletId } from '@theweave/api';
import type { IframeStore } from './iframe-store';

interface SemTreeSubscription {
  id: string;
  patternStr: string;
  patternNode: SemNode;
  topic?: string;
  subscriberAppletId: AppletId;
}

interface PublishedTree {
  tree: SemNodeJSON;
  sourceAppletId: AppletId;
  defs: SemTableDefsJSON;
  topic?: string;
}

/** Shared context for all tool-registered definitions. */
const SHARED_CONTEXT = 1;

export class SemTreeStore {
  private sem: SemTable = createBaseSemTable();
  private subscriptions: Map<string, SemTreeSubscription> = new Map();
  private publishedTrees: PublishedTree[] = [];
  private maxBufferSize = 1000;

  constructor(private iframeStore: IframeStore) {}

  /**
   * Register definitions into the shared vocabulary.
   * Idempotent: if a symbol label already exists, it is not re-created.
   */
  registerDefinitions(defs: SemTableDefsJSON): void {
    // Register structures first (symbols may reference them)
    for (const structDef of defs.structures) {
      if (!this.sem.structureByName(structDef.label)) {
        const partIds = structDef.partLabels.map((partLabel) => {
          const existing = this.sem.symbolByName(partLabel);
          if (!existing) {
            throw new Error(
              `Structure '${structDef.label}' references unknown symbol '${partLabel}'`,
            );
          }
          return existing;
        });
        this.sem.defineStructure(SHARED_CONTEXT, structDef.label, ...partIds);
      }
    }

    // Register symbols
    for (const symDef of defs.symbols) {
      if (!this.sem.symbolByName(symDef.label)) {
        const structId = this.resolveStructure(symDef.structureLabel);
        this.sem.defineSymbol(SHARED_CONTEXT, structId, symDef.label);
      }
    }
  }

  /**
   * Publish a tree. Matches against all active subscriptions and
   * pushes to subscribing iframes.
   */
  publish(appletId: AppletId, tree: SemNodeJSON, topic?: string): void {
    const defs = this.getRegisteredDefs();
    const entry: PublishedTree = {
      tree,
      sourceAppletId: appletId,
      defs,
      topic,
    };

    this.publishedTrees.push(entry);
    if (this.publishedTrees.length > this.maxBufferSize) {
      this.publishedTrees.shift();
    }

    const liveTree = treeFromJSON(tree);

    for (const sub of this.subscriptions.values()) {
      if (topic !== undefined && sub.topic !== undefined && topic !== sub.topic) continue;
      if (match(sub.patternNode, liveTree)) {
        this.pushToSubscriber(sub, entry);
      }
    }
  }

  /**
   * Subscribe to trees matching a semtrex pattern string.
   * Replays existing buffered trees that match.
   * Returns a unique subscription ID.
   */
  subscribe(appletId: AppletId, patternStr: string, topic?: string): string {
    const subId = `sub_${Math.random().toString(36).slice(2)}`;
    const patternNode = parseSemtrex(this.sem, patternStr);
    const sub: SemTreeSubscription = {
      id: subId,
      patternStr,
      patternNode,
      topic,
      subscriberAppletId: appletId,
    };
    this.subscriptions.set(subId, sub);

    // Replay existing published trees
    for (const entry of this.publishedTrees) {
      if (topic !== undefined && entry.topic !== undefined && topic !== entry.topic) continue;
      const liveTree = treeFromJSON(entry.tree);
      if (match(patternNode, liveTree)) {
        this.pushToSubscriber(sub, entry);
      }
    }

    return subId;
  }

  /** Unsubscribe by subscription ID. */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  /** Get the shared SemTable (for testing or internal use). */
  getSemTable(): SemTable {
    return this.sem;
  }

  private pushToSubscriber(sub: SemTreeSubscription, entry: PublishedTree): void {
    const event: SemTreeDataEvent = {
      subscriptionId: sub.id,
      tree: entry.tree,
      defs: entry.defs,
      sourceAppletId: entry.sourceAppletId,
      topic: entry.topic,
    };
    this.iframeStore.postMessageToAppletIframes(
      { type: 'some', ids: [sub.subscriberAppletId] },
      { type: 'semtree-data', data: event },
    );
  }

  private resolveStructure(label: string): import('ceptr-js').SemanticID {
    // Try built-in structures first (by label match)
    const builtinMap: Record<string, import('ceptr-js').SemanticID> = {
      INTEGER: STRUCTURES.INTEGER,
      FLOAT: STRUCTURES.FLOAT,
      CSTRING: STRUCTURES.CSTRING,
      CHAR: STRUCTURES.CHAR,
      BIT: STRUCTURES.BIT,
      SYMBOL: STRUCTURES.SYMBOL,
      BLOB: STRUCTURES.BLOB,
      INTEGER64: STRUCTURES.INTEGER64,
      TREE: STRUCTURES.TREE,
      TREE_PATH: STRUCTURES.TREE_PATH,
      NULL_STRUCTURE: STRUCTURES.NULL_STRUCTURE,
    };
    if (builtinMap[label]) return builtinMap[label];

    const found = this.sem.structureByName(label);
    if (found) return found;

    throw new Error(`Unknown structure label: '${label}'`);
  }

  /** Serialize the current shared definitions for transport. */
  private getRegisteredDefs(): SemTableDefsJSON {
    // We serialize all definitions from the shared context
    const symbols: SemTableDefsJSON['symbols'] = [];
    const structures: SemTableDefsJSON['structures'] = [];

    // Walk the SemTable's shared context entries
    // Since SemTable doesn't expose iteration, we track what we've registered
    // For now, return an empty defs object — subscribers can reconstruct from their own registrations
    // This will be enhanced when SemTable gets iteration support
    return { symbols, structures };
  }
}
