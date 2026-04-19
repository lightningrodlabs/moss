// Maps externally-visible session IDs to AsrSession instances + the
// renderer webContents that owns them. Used by the main-process IPC
// layer to:
//   1. Hand stable IDs back to the renderer (so it can route subsequent
//      pushAudio / close calls).
//   2. Look up which webContents to send back partial/final/error
//      events for a given session.
//   3. Clean up sessions when a renderer goes away (window closed, page
//      reloaded) so we don't leak references into an idle broker.
//
// The registry is Electron-free — it stores a numeric `ownerId` rather
// than a webContents handle. The IPC layer translates between webContents
// instances and ownerId (typically `webContents.id`).

import { randomUUID } from 'node:crypto';

import type { AsrSession } from './session';

export interface SessionEntry {
  session: AsrSession;
  ownerId: number;
}

export class SessionRegistry {
  private readonly entries = new Map<string, SessionEntry>();
  private readonly idGen: () => string;

  constructor(idGen: () => string = randomUUID) {
    this.idGen = idGen;
  }

  /** Register a session and return its newly-allocated ID. */
  register(session: AsrSession, ownerId: number): string {
    const id = this.idGen();
    this.entries.set(id, { session, ownerId });
    return id;
  }

  get(id: string): SessionEntry | undefined {
    return this.entries.get(id);
  }

  /** Remove the entry (does NOT close the underlying session). */
  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  /** All session IDs owned by the given owner. */
  idsForOwner(ownerId: number): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.ownerId === ownerId) ids.push(id);
    }
    return ids;
  }

  /**
   * Drop every entry belonging to the given owner. Returns the removed
   * (id, session) pairs so the caller can close the sessions on the
   * broker side. The registry itself never calls session.close() — it
   * only keeps the map.
   */
  removeAllForOwner(ownerId: number): Array<{ id: string; session: AsrSession }> {
    const removed: Array<{ id: string; session: AsrSession }> = [];
    for (const [id, entry] of this.entries) {
      if (entry.ownerId === ownerId) {
        removed.push({ id, session: entry.session });
      }
    }
    for (const { id } of removed) {
      this.entries.delete(id);
    }
    return removed;
  }

  /** Number of registered sessions. Diagnostic only. */
  get size(): number {
    return this.entries.size;
  }
}
