# Background Processing: Single-Iframe Lifecycle Proposal

## Problem Statement

The original background processor proposal (separate iframe) has significant downsides:

1. **Data Duplication**: Background iframe would load its own copy of data (e.g., posts), potentially doubling memory usage
2. **Race Conditions**: If background processor makes zome calls that change data, synchronization issues between iframes
3. **Data Availability**: Work done in background iframe won't be available to foreground iframe
4. **Notification Frequency**: Notifications may need same frequency in background as foreground (not necessarily slower)

## Solution: Single-Iframe with Lifecycle Management

Instead of separate iframes, use **lifecycle management within the main applet iframe** to:
- Allow tools to continue background processing when inactive
- Enable memory recovery and resource optimization
- Support delayed DOM suspension (not immediate removal)
- Maintain data consistency (single source of truth)
- Support same notification frequency in background as foreground

## Architecture Overview

### Lifecycle States

Each applet iframe can be in one of these states:

1. **`active`**: Applet is currently visible and selected
   - Full DOM rendering
   - All timers/intervals running
   - Full resource usage
   - User can interact
   - **Memory**: Full usage
   - **Restore Speed**: N/A (already active)

2. **`inactive`**: Applet is not visible but recently was active
   - DOM remains in document (hidden with `display: none`)
   - Background processing continues (notifications, sync, etc.)
   - Timers/intervals continue
   - Data stores remain loaded
   - **Transition**: Immediately when deselected
   - **Duration**: Configurable (default: 5 minutes)
   - **Memory**: Full usage (no savings)
   - **Restore Speed**: Instant (~0ms)

3. **`suspended`**: Applet has been inactive for a while
   - DOM elements removed from document (but kept in memory for quick restore)
   - Background processing continues (notifications, sync, etc.)
   - Timers/intervals continue
   - Data stores remain loaded
   - **Transition**: After `inactive` duration expires (default: 5 minutes)
   - **Duration**: Configurable (default: 30 minutes, or until memory pressure)
   - **Memory**: ~30-50% savings (removes layout/rendering, but objects remain)
   - **Restore Speed**: Quick (~10-50ms) - reattach DOM to document

4. **`discarded`**: Applet has been suspended for a long time or memory is constrained
   - Iframe kept in DOM but completely hidden (JavaScript context remains alive)
   - Internal DOM cleared (via `discard-dom` message to iframe)
   - Background processing continues (timers, data stores, etc.) - JavaScript context is preserved
   - **Transition**: After `suspended` duration expires (default: 30 minutes) or on memory pressure
   - **Memory**: ~70-90% savings (DOM cleared, but iframe and JavaScript context remain)
   - **Restore Speed**: Medium (~50-200ms) - restore iframe visibility and rebuild DOM from data stores

**Note**: When an applet is uninstalled, disabled, or abandoned, the iframe is simply removed from the DOM - there's no "destroyed" lifecycle state. Lifecycle states only apply to active applets that may become active again.

### State Transitions

```
active → inactive (immediate when user switches to different applet in same group, or switches groups)
inactive → active (instant restore when user switches back to this applet)
inactive → suspended (after inactivity timeout, default: 5 minutes)
suspended → active (quick restore ~10-50ms when user switches back to this applet)
suspended → discarded (after suspended timeout, default: 30 minutes, or on memory pressure)
discarded → active (slow restore ~200-1000ms, recreate iframe when user switches back)

Note: When user switches groups:
- Applets in the previous group go to 'inactive' state (not destroyed)
- Applets in the new group become 'active' if selected, or 'inactive' if not selected
- All applets continue background processing regardless of which group is active
```

## Implementation

### 1. Extend WeaveClient API with Lifecycle Management

**File:** `libs/api/src/api.ts`

Add lifecycle management to `WeaveClient`:

```typescript
export class WeaveClient {
  // ... existing fields ...

  /**
   * Lifecycle state of this applet iframe.
   * - 'active': Applet is currently visible and selected in the active group
   * - 'inactive': Applet is not visible but recently was active (DOM hidden)
   * - 'suspended': Applet has been inactive for a while (DOM removed but kept in memory)
   * - 'discarded': Applet has been suspended for a long time (iframe removed, recreate on activate)
   * 
   * Note: Lifecycle states apply to applets that may become active again. When an applet
   * is uninstalled, disabled, or abandoned, the iframe is simply removed - no lifecycle state needed.
   */
  readonly lifecycleState: Readable<'active' | 'inactive' | 'suspended' | 'discarded'>;

  /**
   * Subscribe to lifecycle state changes.
   * Allows tools to respond to state changes (e.g., pause/resume timers, cleanup DOM, etc.)
   */
  onLifecycleChange: (
    callback: (state: 'active' | 'inactive' | 'suspended' | 'discarded') => void
  ) => UnsubscribeFunction;

  /**
   * Request lifecycle state change (optional, for tools that want to control their own lifecycle)
   * Note: Moss renderer has final say on lifecycle state
   */
  requestLifecycleState?: (state: 'inactive' | 'suspended') => void;
}
```

### 2. Update RenderInfo to Include Lifecycle State

**File:** `libs/api/src/types.ts`

```typescript
export type RenderInfo =
  | {
      type: 'applet-view';
      view: AppletView;
      appletClient: AppClient;
      profilesClient: ProfilesClient;
      peerStatusStore: ReadonlyPeerStatusStore;
      appletHash: AppletHash;
      groupProfiles: GroupProfile[];
      /**
       * Current lifecycle state of this applet iframe.
       * Tools can use this to optimize their behavior.
       */
      lifecycleState: 'active' | 'inactive' | 'suspended' | 'discarded';
    }
  | {
      type: 'cross-group-view';
      view: CrossGroupView;
      applets: ReadonlyMap<EntryHash, AppletClients>;
    };
```

### 3. Moss Renderer Lifecycle Management

**Files:** 
- `src/renderer/src/layout/views/view-frame.ts` (primary lifecycle management)
- `src/renderer/src/groups/elements/group-container.ts` (coordination)

Lifecycle management should be implemented at the `view-frame` level since that's where iframes are actually created and managed. The `group-container` coordinates which applets are active.

**File:** `src/renderer/src/layout/views/view-frame.ts`

```typescript
@customElement('view-frame')
export class ViewFrame extends LitElement {
  // ... existing properties ...
  
  @state()
  lifecycleState: 'active' | 'inactive' | 'suspended' | 'discarded' = 'active';
  
  @state()
  inactivityTimer: number | undefined;
  
  @state()
  suspendedTimer: number | undefined;
  
  // Configuration
  private readonly INACTIVITY_TO_SUSPENDED = 5 * 60 * 1000; // 5 minutes
  private readonly SUSPENDED_TO_DISCARDED = 30 * 60 * 1000; // 30 minutes

  @consume({ context: mossStoreContext })
  @state()
  mossStore!: MossStore;

  private _dashboardState = new StoreSubscriber(
    this,
    () => this.mossStore.dashboardState(),
    () => [this.mossStore],
  );

  updated(changedProperties: PropertyValues<this>) {
    super.updated(changedProperties);
    
    // Update lifecycle state when dashboard state changes
    if (changedProperties.has('_dashboardState') || changedProperties.has('renderView')) {
      this.updateLifecycleState();
    }
  }

  private updateLifecycleState() {
    if (this.renderView.type !== 'applet-view' || this.iframeKind.type !== 'applet') {
      return; // Only manage lifecycle for applet main views
    }
    
    const appletHash = this.iframeKind.appletHash;
    const dashboardState = this._dashboardState.value;
    
    // Applet is active if:
    // 1. Dashboard is showing a group view
    // 2. This applet is the selected applet in that group
    const isActive = dashboardState.viewType === 'group' &&
      dashboardState.appletHash &&
      encodeHashToBase64(dashboardState.appletHash) === encodeHashToBase64(appletHash);
    
    if (isActive) {
      // Applet is now active (user selected it, or switched to its group)
      this.setLifecycleState('active');
      this.clearInactivityTimer();
    } else {
      // Applet is now inactive (user selected different applet, or switched groups)
      // Note: Applet remains in lifecycle states even when its group is not active
      // It will become active again when user switches back to it
      if (this.lifecycleState === 'active') {
        this.setLifecycleState('inactive');
        this.startInactivityTimer();
      }
      // If already inactive/suspended/discarded, stay in that state
    }
  }

  private setLifecycleState(state: 'active' | 'inactive' | 'suspended' | 'discarded') {
    const previousState = this.lifecycleState;
    this.lifecycleState = state;
    
    // Notify iframe of lifecycle change (if iframe still exists)
    const iframe = this.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'lifecycle-state-change',
        state,
        previousState,
      }, '*');
    }
    
    // Handle state transitions
    if (state === 'suspended' && previousState === 'inactive') {
      this.suspendIframe();
      this.startSuspendedTimer();
    } else if (state === 'discarded' && previousState === 'suspended') {
      this.discardIframe();
    } else if (state === 'active' && previousState === 'suspended') {
      this.restoreIframe();
      this.clearSuspendedTimer();
    } else if (state === 'active' && previousState === 'discarded') {
      this.recreateIframe();
    } else if (state === 'active') {
      this.clearSuspendedTimer();
    }
  }

  private startInactivityTimer() {
    this.clearInactivityTimer();
    
    this.inactivityTimer = window.setTimeout(() => {
      if (this.lifecycleState === 'inactive') {
        this.setLifecycleState('suspended');
      }
    }, this.INACTIVITY_TO_SUSPENDED);
  }

  private startSuspendedTimer() {
    this.clearSuspendedTimer();
    
    this.suspendedTimer = window.setTimeout(() => {
      if (this.lifecycleState === 'suspended') {
        // Check memory pressure before discarding
        if (this.checkMemoryPressure()) {
          this.setLifecycleState('discarded');
        } else {
          // Still discard after timeout, but less aggressively
          this.setLifecycleState('discarded');
        }
      }
    }, this.SUSPENDED_TO_DISCARDED);
  }

  private clearInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = undefined;
    }
  }

  private clearSuspendedTimer() {
    if (this.suspendedTimer) {
      clearTimeout(this.suspendedTimer);
      this.suspendedTimer = undefined;
    }
  }

  private checkMemoryPressure(): boolean {
    // Use performance.memory API if available (Chrome)
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      const usedMB = memory.usedJSHeapSize / 1048576;
      const totalMB = memory.totalJSHeapSize / 1048576;
      return usedMB / totalMB > 0.8; // 80% memory usage
    }
    return false;
  }

  private suspendIframe() {
    // Remove iframe from DOM but keep reference for quick restore
    const iframe = this.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe) {
      // Notify the iframe to suspend its internal DOM
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'suspend-dom',
        }, '*');
      }
      // Hide iframe (still in DOM, just not visible)
      iframe.style.display = 'none';
    }
  }

  private discardIframe() {
    // Remove iframe from DOM entirely (can be garbage collected)
    const iframe = this.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe) {
      // Notify iframe before removing (if still accessible)
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'discard-dom',
        }, '*');
      }
      // Remove from DOM
      iframe.remove();
    }
  }

  private restoreIframe() {
    // Restore iframe to DOM (quick restore from suspended)
    const iframe = this.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe) {
      iframe.style.display = 'block';
      // Notify iframe to restore its internal DOM
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'restore-dom',
        }, '*');
      }
    }
  }

  private recreateIframe() {
    // Recreate iframe from discarded state (slow restore)
    // This will trigger a re-render, which will create a new iframe
    this.requestUpdate();
  }

  render() {
    // ... existing render logic ...
    // Lifecycle state affects visibility but iframe remains in DOM
    // (unless suspended - see DOM suspension strategy)
  }
}
```

### 4. Iframe Lifecycle Message Handling

**File:** `iframes/applet-iframe/src/index.ts`

Handle lifecycle messages from parent:

```typescript
// Listen for lifecycle state changes from parent
window.addEventListener('message', (event) => {
  if (event.data.type === 'lifecycle-state-change') {
    const { state, previousState } = event.data;
    
    // Update renderInfo lifecycle state
    if (window.__WEAVE_RENDER_INFO__ && window.__WEAVE_RENDER_INFO__.type === 'applet-view') {
      window.__WEAVE_RENDER_INFO__.lifecycleState = state;
    }
    
    // Dispatch event for tools to listen to
    window.dispatchEvent(new CustomEvent('weave-lifecycle-change', {
      detail: { state, previousState }
    }));
  }
  
  if (event.data.type === 'suspend-dom') {
    // Tool can implement DOM suspension logic
    window.dispatchEvent(new CustomEvent('weave-suspend-dom'));
  }
});
```

### 5. Tool Implementation Pattern

**Example tool code:**

```typescript
import { WeaveClient } from '@theweave/api';
import { get } from '@holochain-open-dev/stores';

const weaveClient = await WeaveClient.connect(appletServices);

// Get initial lifecycle state
let currentLifecycleState = weaveClient.renderInfo.type === 'applet-view' 
  ? weaveClient.renderInfo.lifecycleState 
  : 'active';

// Subscribe to lifecycle changes
const unsubscribeLifecycle = weaveClient.onLifecycleChange((state) => {
  const previousState = currentLifecycleState;
  currentLifecycleState = state;
  
  console.log(`Lifecycle changed: ${previousState} → ${state}`);
  
  // Handle state transitions
  if (state === 'active' && previousState === 'suspended') {
    // Restore DOM if needed (quick restore)
    restoreDOM();
  } else if (state === 'active' && previousState === 'discarded') {
    // Recreate DOM (slow restore - iframe was recreated)
    // Data stores should still be available
    initializeDOM();
  } else if (state === 'suspended') {
    // Suspend DOM to free memory
    suspendDOM();
  } else if (state === 'discarded') {
    // DOM is being discarded - ensure data is persisted
    persistData();
  }
  
  // Adjust background processing based on state
  // Note: Notifications can run at same frequency regardless of state
  updateBackgroundProcessing(state);
});

// Background processing (notifications, sync, etc.)
let syncInterval: number | undefined;
let notificationInterval: number | undefined;

function updateBackgroundProcessing(state: 'active' | 'inactive' | 'suspended' | 'discarded') {
  // Notifications can run at same frequency regardless of lifecycle state
  // This is tool-specific - some tools may want to slow down when suspended
  const notificationIntervalMs = 30000; // 30 seconds (same for all states)
  
  if (!notificationInterval) {
    notificationInterval = setInterval(async () => {
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
    }, notificationIntervalMs);
  }
  
  // Sync interval might be slower when suspended
  const syncIntervalMs = state === 'suspended' ? 120000 : 30000; // 2 min vs 30 sec
  
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = undefined;
  }
  
  syncInterval = setInterval(async () => {
    // Sync data (but don't duplicate - use same stores as main view)
    await syncData();
  }, syncIntervalMs);
}

// DOM suspension/restoration (optional, for memory optimization)
let suspendedDOM: HTMLElement | null = null;

function suspendDOM() {
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    // Store DOM in memory for quick restore
    suspendedDOM = mainContent.cloneNode(true) as HTMLElement;
    // Remove from document to free memory
    mainContent.remove();
  }
}

function restoreDOM() {
  if (suspendedDOM) {
    const container = document.getElementById('app-container');
    if (container) {
      container.appendChild(suspendedDOM);
      suspendedDOM = null;
    }
  }
}

// Listen for suspend DOM message from parent
window.addEventListener('weave-suspend-dom', () => {
  suspendDOM();
});

// Initial setup
updateBackgroundProcessing(currentLifecycleState);

// Cleanup
window.addEventListener('beforeunload', () => {
  if (syncInterval) clearInterval(syncInterval);
  if (notificationInterval) clearInterval(notificationInterval);
  unsubscribeLifecycle();
});
```

## Addressing Original Concerns

This proposal directly addresses all the concerns raised about the separate iframe approach:

### 1. Data Duplication ❌ → ✅ Solved
**Problem**: Separate iframe would load its own copy of data (e.g., posts), potentially doubling memory usage.

**Solution**: Single iframe means single source of truth. Data loaded for background processing is the same data used by the main view. No duplication.

### 2. Race Conditions ❌ → ✅ Solved
**Problem**: If background processor makes zome calls that change data, synchronization issues between iframes.

**Solution**: All zome calls happen in the same iframe context. No synchronization needed because there's only one context.

### 3. Data Availability ❌ → ✅ Solved
**Problem**: Work done in background iframe won't be available to foreground iframe.

**Solution**: Background work happens in the same iframe, so it's immediately available. When the applet becomes active, all data is already there.

### 4. Notification Frequency ⚠️ → ✅ Solved
**Problem**: Notifications may need same frequency in background as foreground (not necessarily slower).

**Solution**: Tools have full control. They can run notifications at the same frequency regardless of lifecycle state, or adjust as needed. The lifecycle API provides information, but tools decide how to use it.

## Benefits

1. **No Data Duplication**: Single iframe, single source of truth for data
2. **No Race Conditions**: All zome calls from same iframe context
3. **Data Availability**: Background work is immediately available to foreground
4. **Flexible Notification Frequency**: Tools can run notifications at same frequency regardless of lifecycle state
5. **Memory Recovery**: DOM can be suspended after inactivity period
6. **Quick Restore**: Suspended DOM can be restored quickly when applet becomes active
7. **Backward Compatible**: Tools without lifecycle handling continue to work
8. **Simpler Architecture**: One iframe to manage instead of two

## Configuration Options

### Inactivity Timeout

Configurable per applet or globally:

```typescript
// In moss config or per-applet settings
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes (default)
```

### Lifecycle Behavior

Tools can opt-in to different behaviors:

```typescript
// Tool can request suspension earlier
weaveClient.requestLifecycleState?.('suspended');

// Or request to stay active longer
// (Moss renderer has final say, but can respect tool preferences)
```

## Integration with Existing `backgroundProcessor` Pattern

The existing `backgroundProcessor` function in `AppletServices` can still be used, but it will run in the **same iframe** as the main view, not a separate iframe. This means:

1. **No separate iframe creation**: The `backgroundProcessor` function is called from the main applet iframe
2. **Lifecycle-aware execution**: The function receives lifecycle state and can adjust its behavior
3. **Shared data context**: Background processing shares the same data stores as the main view
4. **Optional execution**: Tools can choose to run background processing only when inactive/suspended, or always

### Updated Tool Pattern

```typescript
const appletServices: AppletServices = {
  // ... other services ...
  
  // Background processor runs in same iframe, lifecycle-aware
  backgroundProcessor: async (weaveClient, appletClient, profilesClient, lifecycle) => {
    // This runs in the main applet iframe, not a separate iframe
    // It can access the same data stores, DOM, etc.
    
    // Subscribe to lifecycle changes
    lifecycle.onLifecycleChange((state) => {
      if (state.isGroupActive && state.isAppVisible) {
        // Tool is active - might pause background processing
        // or continue at full speed (tool's choice)
      } else {
        // Tool is inactive - continue background processing
      }
    });
    
    // Background processing logic (notifications, sync, etc.)
    // This shares the same context as the main view
    setInterval(async () => {
      // ... background sync logic ...
    }, 30000);
  },
};

const weaveClient = await WeaveClient.connect(appletServices);

// In main view code, also subscribe to lifecycle
weaveClient.onLifecycleChange((state) => {
  if (state === 'active') {
    // Restore UI, resume timers, etc.
  } else if (state === 'inactive' || state === 'suspended') {
    // Optionally pause UI updates, but background processing continues
  }
});
```

## Migration Path

1. **Phase 1**: Add lifecycle API to WeaveClient (backward compatible)
2. **Phase 2**: Implement lifecycle state management in Moss renderer
3. **Phase 3**: Update `backgroundProcessor` execution to run in main iframe instead of separate iframe
4. **Phase 4**: Tools can optionally implement lifecycle handlers
5. **Phase 5**: Enable DOM suspension for memory optimization
6. **Phase 6**: Remove separate background processor iframe creation code (cleanup)

## Comparison with Separate Iframe Approach

| Aspect | Separate Iframe | Single Iframe Lifecycle |
|--------|----------------|------------------------|
| Data Duplication | ❌ Yes (two copies) | ✅ No (single source) |
| Race Conditions | ❌ Possible | ✅ Not possible |
| Data Availability | ❌ Separate contexts | ✅ Shared context |
| Memory Usage | ⚠️ Higher (two iframes) | ✅ Lower (one iframe) |
| Notification Frequency | ⚠️ Limited by design | ✅ Flexible (tool decides) |
| DOM Suspension | ❌ Not applicable | ✅ Supported |
| Complexity | ⚠️ Higher (two iframes to manage) | ✅ Lower (one iframe) |

## DOM Suspension Strategy Analysis

The question of whether to keep DOM in memory vs discarding it requires careful consideration of memory usage vs restoration speed.

### Option 1: Keep DOM in Memory (Suspended State)
**Approach**: Remove DOM from document but keep elements in memory for quick restore.

**Memory Impact**:
- **Detached DOM elements still consume memory** - JavaScript objects, event listeners, and references remain
- Memory savings: **~30-50%** (removes layout/rendering overhead, but not object memory)
- Browser may garbage collect detached elements if memory pressure is high

**Restoration Speed**:
- **Very fast** - Just reattach to document (~10-50ms)
- No need to recreate elements or re-fetch data
- State is preserved

**Use Case**: Best when:
- User frequently switches back to applet
- Applet has complex DOM structure that's expensive to recreate
- Memory is not critically constrained

### Option 2: Discard DOM Completely
**Approach**: Remove iframe from DOM entirely, recreate when needed.

**Memory Impact**:
- **Maximum memory savings** - iframe and all DOM can be garbage collected
- Memory savings: **~70-90%** (only JavaScript state/data remains)
- Background processing continues (timers, data stores, etc.)

**Restoration Speed**:
- **Slower** - Need to recreate iframe and reload content (~200-1000ms)
- May need to re-fetch data depending on tool implementation
- State may need to be restored from data stores

**Use Case**: Best when:
- User rarely switches back to applet
- Memory is critically constrained
- Applet can quickly restore from data stores

### Option 3: Three-State Approach (Recommended)
**Approach**: Add a third state between inactive and destroyed.

**States**:
1. **`active`**: Full rendering, all resources active
2. **`inactive`**: DOM hidden (`display: none`), background processing continues
3. **`suspended`**: Iframe hidden, internal DOM removed but kept in memory (quick restore)
4. **`discarded`**: Iframe hidden, internal DOM cleared, but iframe and JavaScript context remain alive for background processing (medium restore)

**Note**: When applets are uninstalled/disabled/abandoned, iframes are simply removed - no lifecycle state needed.

**State Transitions**:
```
active → inactive (immediate when deselected or user switches groups)
inactive → suspended (after 5 minutes)
suspended → discarded (after 30 minutes, or on memory pressure)
suspended → active (quick restore ~10-50ms when user selects applet again)
discarded → active (medium restore ~50-200ms, restore iframe visibility and rebuild DOM)
```

**Important**: 
- Applets remain in lifecycle states even when their group is not the active group. They continue background processing and can become active again when the user switches back to that group and selects the applet.
- In `discarded` state, the iframe stays in the DOM (hidden) so the JavaScript context remains alive and background processing (notifications, timers, etc.) continues to work.

**Memory vs Speed Trade-off**:
- **`inactive`**: No memory savings, instant restore
- **`suspended`**: ~30-50% memory savings, ~10-50ms restore
- **`discarded`**: ~70-90% memory savings (DOM cleared), ~50-200ms restore (iframe stays in DOM, just hidden)

**Implementation**:
```typescript
// Configuration
private readonly INACTIVITY_TO_SUSPENDED = 5 * 60 * 1000; // 5 minutes
private readonly SUSPENDED_TO_DISCARDED = 30 * 60 * 1000; // 30 minutes

// Or use memory pressure detection
private checkMemoryPressure(): boolean {
  // Use performance.memory API if available (Chrome)
  if ('memory' in performance) {
    const memory = (performance as any).memory;
    const usedMB = memory.usedJSHeapSize / 1048576;
    const totalMB = memory.totalJSHeapSize / 1048576;
    return usedMB / totalMB > 0.8; // 80% memory usage
  }
  return false;
}
```

### Recommendation: Three-State Approach

**Rationale**:
1. **Flexibility**: Balances memory savings with restoration speed
2. **User Experience**: Quick restore for recently used applets, memory savings for long-unused ones
3. **Adaptive**: Can transition to `discarded` on memory pressure
4. **Tool Control**: Tools can opt-in to faster/slower transitions based on their needs

**Default Behavior**:
- **`inactive`** (0-5 min): Keep DOM, instant restore
- **`suspended`** (5-30 min): Remove DOM from document, quick restore (~10-50ms)
- **`discarded`** (30+ min or memory pressure): Remove iframe, slow restore (~200-1000ms)

**Tool Override**:
```typescript
// Tool can request different behavior
weaveClient.requestLifecycleState?.('suspended'); // Suspend earlier
weaveClient.requestLifecycleState?.('inactive'); // Stay active longer
```

## Important Design Decisions

1. **No "destroyed" state**: When applets are uninstalled, disabled, or abandoned, iframes are simply removed from the DOM. Lifecycle states only apply to active applets that may become active again.

2. **Group switching doesn't destroy applets**: When users switch between groups, applets in the previous group go to `inactive` state (not destroyed). They continue background processing and can become active again when the user switches back.

3. **Lifecycle based on selection, not group**: An applet is `active` when it's the selected applet in the currently viewed group. It's `inactive` when not selected, regardless of which group is active.

## Open Questions

1. **DOM Suspension Strategy**: Three-state approach recommended (inactive → suspended → discarded)
2. **Inactivity Timeout**: Default 5 minutes to suspended, 30 minutes to discarded (configurable)
3. **State Persistence**: Should suspended/discarded state persist across app restarts? (Probably not - start fresh)
4. **Resource Monitoring**: Should lifecycle state be influenced by system resource usage? (Yes - transition to discarded on memory pressure)
5. **Tool Opt-in**: Should tools be able to disable DOM suspension entirely? (Yes - for critical real-time tools)

## Related Documents

- [Background Processing Proposal](./BACKGROUND_PROCESSING_PROPOSAL.md) - Original separate iframe proposal
- [Performance Optimization Plan](./PERFORMANCE_OPTIMIZATION_PLAN.md) - Overall performance goals
- [Background Processor Notification Analysis](./BACKGROUND_PROCESSOR_NOTIFICATION_ANALYSIS.md) - Notification patterns

