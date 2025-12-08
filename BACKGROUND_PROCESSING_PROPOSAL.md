# Background Processing Support Proposal

This document proposes adding background processing support to the Weave API to enable performance optimization 2.1b (Only Render Selected Applet) without breaking tool functionality.

## Problem Statement

Currently, optimization 2.1b cannot be implemented because:
- Tools need to run background tasks (notifications, sync, etc.) even when not visible
- Destroying iframes when deselected would break these background processes
- We need a pattern for tools to register background processing elements

## Solution Overview

Extend the `AppletServices` interface to include an optional background processor function, following the same pattern as existing services like `creatables`, `blockTypes`, `search`, and `getAssetInfo`.

## Implementation Details

### 1. Extend AppletServices Class

**File:** `libs/api/src/api.ts`

Add a new optional field to the `AppletServices` class:

```typescript
export class AppletServices {
  constructor() {
    (this.creatables = {}),
      (this.blockTypes = {}),
      (this.search = async (_appletClient, _appletHash, _weaveServices, _searchFilter) => []),
      (this.getAssetInfo = async (_appletClient, _wal, _recordInfo) => undefined);
      (this.backgroundProcessor = undefined); // NEW
  }

  /**
   * Creatables that this Applet offers to be created from a We dialog
   */
  creatables: Record<CreatableName, CreatableType>;

  /**
   * Render block types that this Applet offers
   */
  blockTypes: Record<BlockName, BlockType>;
  
  /**
   * Get info about the specified entry of this Applet
   */
  getAssetInfo: (
    appletClient: AppClient,
    wal: WAL,
    recordInfo?: RecordInfo,
  ) => Promise<AssetInfo | undefined>;
  
  /**
   * Search in this Applet
   */
  search: (
    appletClient: AppClient,
    appletHash: AppletHash,
    weaveServices: WeaveServices,
    searchFilter: string,
  ) => Promise<Array<WAL>>;

  /**
   * Optional background processor function that runs independently of the main applet view.
   * This function is executed in a separate lightweight iframe context that persists
   * even when the main applet view is not rendered or when users switch between groups.
   * 
   * The function receives a WeaveClient instance with limited API access (notifications,
   * signals, etc.) and should handle background tasks like:
   * - Periodic data synchronization
   * - Notification processing
   * - Background data fetching
   * - WebSocket connections
   * 
   * The background processor iframe is created when the applet is first loaded and
   * persists until the applet is uninstalled or the application is closed.
   * 
   * The processor receives lifecycle events to allow it to throttle or pause processing
   * when appropriate (e.g., when app is in background, when group is not active, etc.).
   */
  backgroundProcessor?: (
    weaveClient: WeaveClient,
    appletClient: AppClient,
    profilesClient: ProfilesClient,
    lifecycle: BackgroundProcessorLifecycle,
  ) => Promise<void> | void;
}
```

### 2. Extend RenderInfo Type and Add Lifecycle Interface

**File:** `libs/api/src/types.ts`

Add a new renderInfo type for background processors and lifecycle interface:

```typescript
export type RenderInfo = 
  | { 
      type: 'applet-view'; 
      view: AppletView; 
      appletClient: AppClient;
      profilesClient: ProfilesClient;
      peerStatusStore: Readable<PeerStatusMap>;
      // ... other fields
    }
  | { 
      type: 'cross-group-view'; 
      view: CrossGroupView; 
      // ... other fields
    }
  | { 
      type: 'background-processor'; // NEW
      appletHash: AppletHash;
      appletClient: AppClient;
      profilesClient: ProfilesClient;
      peerStatusStore: Readable<PeerStatusMap>;
      groupDnaHash: DnaHash; // Group this applet belongs to
    };

/**
 * Lifecycle management interface for background processors.
 * Allows processors to respond to system state changes and throttle/pause processing.
 */
export interface BackgroundProcessorLifecycle {
  /**
   * Whether the application tab/window is currently visible to the user.
   * Processors should throttle or pause non-critical work when false.
   */
  isAppVisible: Readable<boolean>;
  
  /**
   * Whether the applet's group is currently the active group being viewed.
   * Processors may want to reduce activity when their group is not active.
   */
  isGroupActive: Readable<boolean>;
  
  /**
   * Current system resource state. Processors should respect this and reduce
   * activity when resources are constrained.
   */
  resourceState: Readable<'normal' | 'constrained' | 'critical'>;
  
  /**
   * Subscribe to lifecycle changes. Callback receives the new lifecycle state.
   */
  onLifecycleChange: (callback: (state: {
    isAppVisible: boolean;
    isGroupActive: boolean;
    resourceState: 'normal' | 'constrained' | 'critical';
  }) => void) => UnsubscribeFunction;
}
```

### 3. Background Processor Execution Context

**Files:**
- `src/renderer/src/applets/applet-host.ts` (Background processor iframe management)
- `src/renderer/src/layout/views/view-frame.ts` (Background processor rendering)

**Implementation:**

1. When `WeaveClient.connect(appletServices)` is called and `appletServices.backgroundProcessor` is defined:
   - Create a separate iframe with `renderInfo.type === 'background-processor'`
   - Load the same UI bundle but with the background processor renderInfo
   - Execute the background processor function in that context
   - Keep this iframe alive even when main view is destroyed

2. The background processor iframe has access to a limited WeaveClient API:
   - ✅ `notifyFrame()` - for notifications
   - ✅ `onRemoteSignal()` / `sendRemoteSignal()` - for inter-applet communication
   - ✅ `appletClient` - for zome calls
   - ✅ `profilesClient` - for profile access
   - ✅ `onPeerStatusUpdate()` - for peer status updates
   - ❌ `openAppletMain()`, `openAsset()`, etc. (view-related APIs should be disabled or throw errors)

3. Lifecycle management:
   - Background processor iframe is created when applet is first loaded
   - Persists independently of main view iframe lifecycle
   - **Continues running when users switch between groups** (applet remains installed)
   - Destroyed only when applet is uninstalled or application is closed
   - Receives lifecycle events to allow throttling/pausing when appropriate:
     - When app/tab is not visible
     - When applet's group is not the active group
     - When system resources are constrained

### 4. Tool Implementation Pattern

**Example tool code:**

```typescript
// In tool's UI code
import { WeaveClient, AppletServices } from '@theweave/api';
import { get } from '@holochain-open-dev/stores'; // For reading Readable stores

const appletServices: AppletServices = {
  creatables: {
    'post': {
      label: 'post',
      icon_src: 'data:image/png;base64,...',
    },
  },
  blockTypes: {
    'recent_posts': {
      label: 'Recent Posts',
      icon_src: 'data:image/png;base64,...',
      view: 'applet-view',
    },
  },
  search: async (appletClient, appletHash, weaveServices, searchFilter) => {
    // Search implementation
    return [];
  },
  getAssetInfo: async (appletClient, wal, recordInfo) => {
    // Asset info implementation
    return undefined;
  },
  
  // NEW: Background processor
  backgroundProcessor: async (weaveClient, appletClient, profilesClient, lifecycle) => {
    let syncInterval: number | undefined;
    let syncIntervalMs = 30000; // Default: every 30 seconds
    
    // Adjust sync frequency based on lifecycle state
    const updateSyncInterval = () => {
      const isVisible = get(lifecycle.isAppVisible);
      const isActive = get(lifecycle.isGroupActive);
      const resources = get(lifecycle.resourceState);
      
      // Pause sync when app not visible or resources critical
      if (!isVisible || resources === 'critical') {
        if (syncInterval) {
          clearInterval(syncInterval);
          syncInterval = undefined;
        }
        return;
      }
      
      // Throttle sync when group not active or resources constrained
      let newInterval = 30000; // Default
      if (!isActive) {
        newInterval = 120000; // 2 minutes when group not active
      } else if (resources === 'constrained') {
        newInterval = 60000; // 1 minute when resources constrained
      }
      
      // Update interval if it changed
      if (syncInterval && newInterval !== syncIntervalMs) {
        clearInterval(syncInterval);
        syncInterval = undefined;
      }
      
      if (!syncInterval) {
        syncIntervalMs = newInterval;
        syncInterval = setInterval(async () => {
          try {
            const updates = await appletClient.callZome({
              role_name: 'forum',
              zome_name: 'posts',
              fn_name: 'get_recent_updates',
              payload: { since: lastSyncTime },
            });
            
            if (updates.length > 0) {
              await weaveClient.notifyFrame([{
                title: 'New posts',
                body: `${updates.length} new posts available`,
                urgency: 'low',
              }]);
              lastSyncTime = Date.now();
            }
          } catch (e) {
            console.error('Background sync error:', e);
          }
        }, syncIntervalMs);
      }
    };
    
    // Subscribe to lifecycle changes
    lifecycle.onLifecycleChange((state) => {
      updateSyncInterval();
    });
    
    // Initial setup
    updateSyncInterval();
    
    // Set up WebSocket connections for real-time updates
    // Only connect when app is visible and group is active
    let ws: WebSocket | undefined;
    const connectWebSocket = () => {
      const isVisible = get(lifecycle.isAppVisible);
      const isActive = get(lifecycle.isGroupActive);
      
      if (isVisible && isActive && !ws) {
        ws = new WebSocket('wss://example.com/updates');
        ws.onmessage = async (event) => {
          const data = JSON.parse(event.data);
          await weaveClient.notifyFrame([{
            title: data.title,
            body: data.body,
            urgency: data.urgency || 'normal',
          }]);
        };
        ws.onclose = () => {
          ws = undefined;
          // Reconnect after delay if conditions are still met
          setTimeout(() => {
            if (get(lifecycle.isAppVisible) && get(lifecycle.isGroupActive)) {
              connectWebSocket();
            }
          }, 5000);
        };
      } else if ((!isVisible || !isActive) && ws) {
        ws.close();
        ws = undefined;
      }
    };
    
    // Update WebSocket connection on lifecycle changes
    lifecycle.onLifecycleChange(() => {
      connectWebSocket();
    });
    
    // Initial connection
    connectWebSocket();
    
    // Set up signal listeners (always active, but can throttle processing)
    weaveClient.onRemoteSignal(async (payload) => {
      // Throttle signal processing when resources are constrained
      const resources = get(lifecycle.resourceState);
      if (resources === 'critical') {
        // Queue for later processing instead of processing immediately
        return;
      }
      
      // Handle remote signals
      const signal = decode(payload);
      // Process signal...
    });
    
    // Cleanup function (optional, but recommended)
    return () => {
      if (syncInterval) clearInterval(syncInterval);
      if (ws) ws.close();
    };
  },
};

const weaveClient = await WeaveClient.connect(appletServices);

// Handle different view types
switch (weaveClient.renderInfo.type) {
  case 'applet-view':
    // Main view rendering
    break;
  case 'background-processor':
    // Background processor execution
    if (appletServices.backgroundProcessor) {
      // Create lifecycle interface for this processor
      const lifecycle = createBackgroundProcessorLifecycle(
        weaveClient.renderInfo.groupDnaHash,
        mossStore, // or however to access moss store
      );
      
      await appletServices.backgroundProcessor(
        weaveClient,
        weaveClient.renderInfo.appletClient,
        weaveClient.renderInfo.profilesClient,
        lifecycle,
      );
    }
    break;
}
```

## Benefits

1. **Follows existing patterns**: Uses the same `AppletServices` pattern as other tool services
2. **No separate infrastructure**: Uses the same UI bundle, just different renderInfo
3. **Holochain-native**: No need for separate URLs, permissions, or worker threads
4. **Flexible**: Tools can implement any background processing logic they need
5. **Type-safe**: Full TypeScript support with existing types

## Migration Path

1. **Phase 1**: Add `backgroundProcessor` field to `AppletServices` (optional, backward compatible)
2. **Phase 2**: Implement background processor iframe creation in Moss
3. **Phase 3**: Tools can optionally add background processors
4. **Phase 4**: Implement optimization 2.1b (only render selected applet)

## Open Questions

1. Should background processors be paused when the tab is not visible? (Similar to optimization 1.3)
2. Should there be resource limits on background processors? (CPU, memory, network)
3. How should errors in background processors be handled and reported?
4. Should background processors be able to request to open views? (Probably not, but worth discussing)

## Related Documents

- [Performance Optimization Plan](./PERFORMANCE_OPTIMIZATION_PLAN.md) - See optimization 2.1a and 2.1b
- [Weave API Documentation](../libs/api/README.md) - For existing AppletServices patterns

