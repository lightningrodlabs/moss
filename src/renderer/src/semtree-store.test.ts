import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBaseSemTable,
  newRoot,
  newStr,
  treeToJSON,
  STRUCTURES,
  type SemNodeJSON,
} from 'ceptr-js';
import { SemTreeStore } from './semtree-store';
import type { IframeStore } from './iframe-store';
import type { ParentToAppletMessage, SemTreeDataEvent } from '@theweave/api';

function createMockIframeStore(): IframeStore & {
  sentMessages: Array<{ appletIds: any; message: ParentToAppletMessage }>;
} {
  const sentMessages: Array<{ appletIds: any; message: ParentToAppletMessage }> = [];
  return {
    sentMessages,
    postMessageToAppletIframes: vi.fn(async (appletIds, message) => {
      sentMessages.push({ appletIds, message });
    }),
  } as any;
}

function buildTaskTree(): SemNodeJSON {
  const sem = createBaseSemTable();
  const TASK = sem.defineSymbol(1, STRUCTURES.TREE, 'TASK');
  const TITLE = sem.defineSymbol(1, STRUCTURES.CSTRING, 'TITLE');
  const STATUS = sem.defineSymbol(1, STRUCTURES.CSTRING, 'STATUS');

  const task = newRoot(TASK);
  newStr(task, TITLE, 'Build semtrex');
  newStr(task, STATUS, 'in-progress');
  return treeToJSON(task, sem) as SemNodeJSON;
}

const TASK_DEFS = {
  symbols: [
    { label: 'TASK', structureLabel: 'TREE' },
    { label: 'TITLE', structureLabel: 'CSTRING' },
    { label: 'STATUS', structureLabel: 'CSTRING' },
  ],
  structures: [],
};

describe('SemTreeStore', () => {
  let store: SemTreeStore;
  let mockIframeStore: ReturnType<typeof createMockIframeStore>;

  beforeEach(() => {
    mockIframeStore = createMockIframeStore();
    store = new SemTreeStore(mockIframeStore);
  });

  describe('registerDefinitions', () => {
    it('registers symbols idempotently', () => {
      store.registerDefinitions(TASK_DEFS);
      // Second registration should not throw
      store.registerDefinitions(TASK_DEFS);

      const sem = store.getSemTable();
      expect(sem.symbolByName('TASK')).toBeDefined();
      expect(sem.symbolByName('TITLE')).toBeDefined();
      expect(sem.symbolByName('STATUS')).toBeDefined();
    });

    it('same label returns same SemanticID', () => {
      store.registerDefinitions(TASK_DEFS);
      const taskId1 = store.getSemTable().symbolByName('TASK');

      store.registerDefinitions(TASK_DEFS);
      const taskId2 = store.getSemTable().symbolByName('TASK');

      expect(taskId1).toEqual(taskId2);
    });

    it('throws for unknown structure label', () => {
      expect(() =>
        store.registerDefinitions({
          symbols: [{ label: 'FOO', structureLabel: 'NONEXISTENT' }],
          structures: [],
        }),
      ).toThrow('Unknown structure label');
    });
  });

  describe('subscribe then publish', () => {
    it('subscriber receives matching tree', () => {
      store.registerDefinitions(TASK_DEFS);

      const subId = store.subscribe('applet-b', '/TASK/(TITLE,STATUS)');
      expect(subId).toBeTruthy();

      const tree = buildTaskTree();
      store.publish('applet-a', tree, 'tasks');

      expect(mockIframeStore.sentMessages).toHaveLength(1);
      const msg = mockIframeStore.sentMessages[0];
      expect(msg.appletIds).toEqual({ type: 'some', ids: ['applet-b'] });
      expect(msg.message.type).toBe('semtree-data');
      const data = (msg.message as any).data as SemTreeDataEvent;
      expect(data.subscriptionId).toBe(subId);
      expect(data.sourceAppletId).toBe('applet-a');
      expect(data.tree).toEqual(tree);
    });
  });

  describe('publish then subscribe (replay)', () => {
    it('new subscriber gets replay of matching trees', () => {
      store.registerDefinitions(TASK_DEFS);

      const tree = buildTaskTree();
      store.publish('applet-a', tree, 'tasks');

      expect(mockIframeStore.sentMessages).toHaveLength(0);

      const subId = store.subscribe('applet-b', '/TASK/(TITLE,STATUS)');

      expect(mockIframeStore.sentMessages).toHaveLength(1);
      const data = (mockIframeStore.sentMessages[0].message as any).data as SemTreeDataEvent;
      expect(data.subscriptionId).toBe(subId);
      expect(data.tree).toEqual(tree);
    });
  });

  describe('topic filtering', () => {
    it('subscriber with topic only gets matching topic', () => {
      store.registerDefinitions(TASK_DEFS);

      store.subscribe('applet-b', '/TASK/(TITLE,STATUS)', 'tasks');

      const tree = buildTaskTree();
      store.publish('applet-a', tree, 'other-topic');

      expect(mockIframeStore.sentMessages).toHaveLength(0);
    });

    it('subscriber with matching topic receives tree', () => {
      store.registerDefinitions(TASK_DEFS);

      store.subscribe('applet-b', '/TASK/(TITLE,STATUS)', 'tasks');

      const tree = buildTaskTree();
      store.publish('applet-a', tree, 'tasks');

      expect(mockIframeStore.sentMessages).toHaveLength(1);
    });

    it('subscriber without topic receives all trees', () => {
      store.registerDefinitions(TASK_DEFS);

      store.subscribe('applet-b', '/TASK/(TITLE,STATUS)');

      const tree = buildTaskTree();
      store.publish('applet-a', tree, 'any-topic');

      expect(mockIframeStore.sentMessages).toHaveLength(1);
    });
  });

  describe('semtrex pattern filtering', () => {
    it('non-matching trees not delivered', () => {
      store.registerDefinitions(TASK_DEFS);

      // Subscribe for trees with just TITLE (not the TASK wrapper)
      store.subscribe('applet-b', '/TITLE');

      const tree = buildTaskTree(); // This is TASK/(TITLE,STATUS)
      store.publish('applet-a', tree);

      // /TITLE matches a node whose root symbol is TITLE, but our tree root is TASK
      expect(mockIframeStore.sentMessages).toHaveLength(0);
    });
  });

  describe('unsubscribe', () => {
    it('stops delivery after unsubscribe', () => {
      store.registerDefinitions(TASK_DEFS);

      const subId = store.subscribe('applet-b', '/TASK/(TITLE,STATUS)');
      store.unsubscribe(subId);

      const tree = buildTaskTree();
      store.publish('applet-a', tree);

      expect(mockIframeStore.sentMessages).toHaveLength(0);
    });
  });

  describe('buffer eviction', () => {
    it('oldest trees dropped when buffer is full', () => {
      store.registerDefinitions(TASK_DEFS);

      // Publish more trees than buffer size
      // We use a small buffer by accessing private field (test-only hack)
      (store as any).maxBufferSize = 3;

      for (let i = 0; i < 5; i++) {
        store.publish('applet-a', buildTaskTree());
      }

      // Buffer should only have 3 entries
      expect((store as any).publishedTrees).toHaveLength(3);
    });
  });

  describe('multiple subscribers', () => {
    it('both subscribers receive matching trees', () => {
      store.registerDefinitions(TASK_DEFS);

      store.subscribe('applet-b', '/TASK/(TITLE,STATUS)');
      store.subscribe('applet-c', '/TASK/(TITLE,STATUS)');

      const tree = buildTaskTree();
      store.publish('applet-a', tree);

      expect(mockIframeStore.sentMessages).toHaveLength(2);
      const appletIds = mockIframeStore.sentMessages.map(
        (m) => m.appletIds.ids[0],
      );
      expect(appletIds).toContain('applet-b');
      expect(appletIds).toContain('applet-c');
    });
  });
});
