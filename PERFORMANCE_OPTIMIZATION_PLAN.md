# Performance Optimization Plan

Based on analysis of the codebase, this document outlines a staged approach to address the top three performance bottlenecks.

## Summary of Issues

1. **Excessive Concurrent Polling Intervals** - Multiple timers running simultaneously
2. **Rendering All Applets Even When Hidden** - All running applet iframes are created/loaded even when not visible (CRITICAL for common case)
3. **Inefficient Data Transformations in Render Functions** - Repeated filter/map/sort chains
4. **Expensive Async Processing in Render Pipeline** - Heavy async work in StoreSubscribers (LOW VALUE - only affects rarely-used unjoined tools tab)

---

## Stage 1: Quick Wins (High Impact, Low Complexity)
**Estimated Time: 2-3 days**  
**Expected Impact: 30-40% performance improvement**

### 1.1 Memoize Data Transformations in Render Functions (UNJOINED TOOLS - LOW VALUE)
**Priority: LOW** (Rarely used feature)  
**Complexity: LOW**  
**Files:** `src/renderer/src/groups/elements/group-home.ts`

**Note:** This optimization only affects the "Unactivated Tools" tab which is rarely used. Low priority.

**Changes:**
- Move `TimeAgo` instance creation outside render function (create once, reuse)
- Memoize filtered/sorted applet lists using proper cache key based on actual data
- Cache `ignoredApplets` lookup result

**Cache Update Frequency:**
- The underlying `unjoinedApplets` store polls every **10 seconds** (currently) or **20 seconds** (after optimization 1.2)
- The store only updates when data actually changes (new applet added, removed, or metadata changed)
- When the store updates, the `StoreSubscriber` automatically re-runs, which will invalidate the cache
- **New applets will appear within 10-20 seconds** of being added to the network (same as current behavior)

**Implementation:**
```typescript
// At class level
private _timeAgo = new TimeAgo('en-US');
private _cachedFilteredApplets: any[] | null = null;
private _cachedAppletsKey: string | null = null;

// In render function, check cache before processing
renderNewApplets() {
  // ... existing code ...
  if (this._unjoinedApplets.value.status !== 'complete') {
    // ... handle pending/error states ...
  }
  
  // Create cache key based on actual applet hashes + filter state
  // This ensures cache invalidates when applets are added/removed, not just when count changes
  const appletHashes = Array.from(this._unjoinedApplets.value.value.keys())
    .map(h => encodeHashToBase64(h))
    .sort()
    .join(',');
  const ignoredApplets = this.mossStore.persistedStore.ignoredApplets.value(
    encodeHashToBase64(this._groupStore.groupDnaHash),
  );
  const ignoredKey = ignoredApplets ? ignoredApplets.sort().join(',') : '';
  const cacheKey = `${appletHashes}-${this._showIgnoredApplets}-${this._recentlyJoined.length}-${ignoredKey}`;
  
  // Return cached result if key matches
  if (this._cachedAppletsKey === cacheKey && this._cachedFilteredApplets) {
    return this._cachedFilteredApplets;
  }
  
  // Process and cache
  const filteredApplets = this._unjoinedApplets.value.value
    .filter(/* ... existing filters ... */)
    .map(/* ... existing mapping ... */)
    .filter(/* ... existing filters ... */)
    .sort(/* ... existing sort ... */);
  
  this._cachedAppletsKey = cacheKey;
  this._cachedFilteredApplets = filteredApplets;
  
  return filteredApplets;
}
```

**Impact:** 
- Eliminates redundant processing on every render cycle
- Cache automatically invalidates when underlying data changes (via StoreSubscriber)
- **No change to update frequency** - new applets still appear within 10-20 seconds

---

### 1.2 Increase Polling Intervals for Non-Critical Data
**Priority: HIGH**  
**Complexity: LOW**  
**Files:** `src/renderer/src/groups/group-store.ts`

**Changes:**
- Increase `ASSET_RELATION_POLLING_PERIOD` from 10s to 30s
- Increase `NEW_APPLETS_POLLING_FREQUENCY` from 10s to 15s (modified from plan: 20s)
- Keep peer status update interval unchanged (5s in `group-area-sidebar.ts`)
- Remove or consolidate the 4 staggered profile refetch timeouts (keep only one at 40s)

**Implementation:**
```typescript
// group-store.ts
const ASSET_RELATION_POLLING_PERIOD = 30000; // 30 seconds (was 10s)
export const NEW_APPLETS_POLLING_FREQUENCY = 15000; // 15 seconds (was 10s)

// Remove lines 192-206, replace with single timeout:
setTimeout(async () => {
  this.allAgents = await this.profilesStore.client.getAgentsWithProfile(true);
}, 40000);
```

**Impact:** Reduces background network activity by 50-70%

---

### 1.3 Add Visibility-Based Polling
**Priority: MEDIUM**  
**Complexity: LOW**  
**Files:** `src/renderer/src/groups/group-store.ts`, `src/renderer/src/elements/_new_design/navigation/group-area-sidebar.ts`

**Changes:**
- Pause polling when tab/window is not visible
- Resume polling when tab becomes visible

**Implementation:**
```typescript
// In GroupStore constructor
this._isVisible = document.visibilityState === 'visible';
document.addEventListener('visibilitychange', () => {
  this._isVisible = document.visibilityState === 'visible';
});

// In polling intervals, check visibility:
window.setInterval(async () => {
  if (!this._isVisible) return; // Skip if tab not visible
  // ... existing polling code ...
}, ASSET_RELATION_POLLING_PERIOD);
```

**Impact:** Eliminates unnecessary polling when user isn't viewing the app

---

## Stage 2: Medium Complexity Optimizations (High Impact for Common Case)
**Estimated Time: 1-2 weeks**  
**Expected Impact: Additional 40-50% improvement**

### 2.1 Only Render Selected Applet (CRITICAL - Common Case)
**Priority: CRITICAL**  
**Complexity: MEDIUM-HIGH** (requires Weave API changes)  
**Files:** 
- `src/renderer/src/groups/elements/applet-main-views.ts`
- `@theweave/api` (Weave API changes)
- Background processing infrastructure

**Problem:** Currently renders ALL running applets with iframes, hiding unused ones with `display: none`. This means:
- All applet iframes are created and loaded even when not visible
- Each iframe loads its full content, consuming memory and CPU
- With 10+ applets in a group, this creates significant overhead

**⚠️ Important Constraint:** 
This optimization **cannot be implemented** without first adding support for background processing, because:
- Tools need to run background tasks (notifications, sync, etc.) even when not visible
- Destroying iframes when deselected would break these background processes
- We need a pattern for tools to register background processing elements

**Required Changes:**

#### 2.1a: Add Background Processing Support to Weave API
**Priority: CRITICAL (Prerequisite for 2.1b)**  
**Complexity: HIGH**  
**Files:** 
- `libs/api/src/api.ts` (AppletServices class)
- `libs/api/src/types.ts` (Type definitions)
- `src/renderer/src/applets/applet-host.ts` (Background processor iframe management)
- `src/renderer/src/layout/views/view-frame.ts` (Background processor rendering)

**Changes:**
- Extend `AppletServices` class to include optional `backgroundProcessor` function field
- Add new `RenderInfo` type: `'background-processor'`
- Implement background processor iframe creation and lifecycle management in Moss
- Provide limited WeaveClient API access to background processors (notifications, signals, zome calls)

**See detailed proposal:** [Background Processing Proposal](./BACKGROUND_PROCESSING_PROPOSAL.md)

**Impact:** 
- Enables optimization 2.1b without breaking tool functionality
- Follows existing Weave API patterns (similar to how creatables/blockTypes work)
- Tools define background processing in the same place they define other services
- Background processors run in the same UI bundle, just in a separate iframe context

---

#### 2.1b: Only Render Selected Applet (Requires 2.1a)
**Priority: CRITICAL**  
**Complexity: MEDIUM**  
**Files:** `src/renderer/src/groups/elements/applet-main-views.ts`

**Changes:**
- Only render the currently selected applet's main view
- Keep background processing iframes running (from 2.1a)
- Lazy-load applet main view iframes when selected
- Unload/destroy main view iframes when applet is deselected
- Use conditional rendering instead of `display: none`

**Implementation:**
```typescript
// In applet-main-views.ts
render() {
  switch (this._runningGroupApplets.value.status) {
    case 'complete':
      const selectedAppletHash = this._dashboardState.value.appletHash;
      if (!selectedAppletHash) {
        return html``; // No applet selected
      }
      
      // Only render the selected applet's main view
      const appletHash = Array.from(this._runningGroupApplets.value.value).find(
        (hash) => encodeHashToBase64(hash) === encodeHashToBase64(selectedAppletHash)
      );
      
      if (!appletHash) {
        return html`Applet not found`;
      }
      
      return html`
        <applet-main
          .appletHash=${appletHash}
          .reloading=${this._reloadingApplets.includes(encodeHashToBase64(appletHash))}
          style="flex: 1;"
          @hard-refresh=${async () => {
            // ... existing refresh logic ...
          }}
        ></applet-main>
      `;
  }
}

// Background processing iframes are managed separately and always running
```

**Impact:** 
- **Massive improvement** for common case (selected tool)
- Reduces memory usage by 70-90% (only one main iframe loaded)
- Reduces CPU usage (only one main applet view running)
- Faster applet switching (no need to hide/show, just create/destroy)
- Scales better with many applets in group
- **Background processing continues uninterrupted**

---

### 2.2 Move Expensive Async Processing to Computed Stores (UNJOINED TOOLS - LOW VALUE)
**Priority: LOW** (Rarely used feature)  
**Complexity: MEDIUM**  
**Files:** `src/renderer/src/groups/elements/group-home.ts`, `src/renderer/src/groups/group-store.ts`

**Note:** This only affects the rarely-used "Unactivated Tools" tab. Low priority unless users report issues.

**Changes:**
- Create a new computed store in `GroupStore` for enriched unjoined applets
- Move async processing (applet entry fetching, tool info fetching) out of render pipeline
- Cache results with proper invalidation strategy
- Only recompute when underlying data changes

**Implementation:**
```typescript
// In GroupStore
enrichedUnjoinedApplets = pipe(
  this.unjoinedApplets,
  async (appletsAndKeys) => {
    // Process in batches to avoid overwhelming the system
    const batchSize = 5;
    const entries = Array.from(appletsAndKeys.entries());
    const results = [];
    
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async ([appletHash, [agentKey, timestamp, joinedMembers]]) => {
          // ... existing processing logic ...
        })
      );
      results.push(...batchResults);
    }
    return results;
  }
);

// In group-home.ts, replace _unjoinedApplets StoreSubscriber:
_enrichedUnjoinedApplets = new StoreSubscriber(
  this,
  () => this._groupStore.enrichedUnjoinedApplets,
  () => [this._groupStore],
);
```

**Impact:** Prevents render blocking, processes data only when needed

---

### 2.3 Implement Request-Based Polling Instead of Time-Based
**Priority: MEDIUM**  
**Complexity: MEDIUM**  
**Files:** `src/renderer/src/groups/group-store.ts`

**Changes:**
- Replace fixed intervals with exponential backoff
- Poll more frequently after user actions, less when idle
- Use `requestIdleCallback` for non-critical polling

**Implementation:**
```typescript
private _pollAssetRelations = () => {
  if (this._isVisible) {
    // ... existing polling logic ...
  }
  // Exponential backoff: 10s -> 20s -> 40s -> max 60s
  const nextDelay = Math.min(
    this._assetPollDelay * 2,
    60000
  );
  this._assetPollDelay = nextDelay;
  setTimeout(this._pollAssetRelations, nextDelay);
};

// Reset to fast polling after user interaction
onUserInteraction() {
  this._assetPollDelay = 10000;
  this._pollAssetRelations();
}
```

**Impact:** Reduces idle-time polling while maintaining responsiveness

---

### 2.4 Consolidate Multiple StoreSubscribers for Running Applets
**Priority: MEDIUM**  
**Complexity: MEDIUM**  
**Files:** `src/renderer/src/groups/elements/applet-main-views.ts`, `src/renderer/src/elements/_new_design/navigation/group-area-sidebar.ts`

**Changes:**
- Combine related StoreSubscribers for running applets into single computed stores
- Reduce number of reactive subscriptions that trigger re-renders
- Optimize sidebar applet rendering

**Implementation:**
```typescript
// In applet-main-views.ts, combine dashboard state and applets:
_appletViewData = new StoreSubscriber(
  this,
  () => joinAsync([
    this._groupStore.allMyRunningApplets,
    this._mossStore.dashboardState(),
  ]),
  () => [this._groupStore, this._mossStore],
);
```

**Impact:** Reduces subscription overhead and re-render frequency for common case

---

## Stage 3: Advanced Optimizations (Medium-High Impact)
**Estimated Time: 2-3 weeks**  
**Expected Impact: Additional 20-30% improvement + better scalability**

### 3.1 Implement Proper Reactive Subscriptions (Replace Polling)
**Priority: HIGH**  
**Complexity: HIGH**  
**Files:** Multiple files across the codebase

**Changes:**
- Replace polling with event-driven updates where possible
- Use Holochain signals for real-time updates
- Implement proper cache invalidation strategies
- Only poll as fallback when signals unavailable

**Implementation:**
```typescript
// Listen to signals instead of polling
this.groupClient.onSignal((signal) => {
  if (signal.type === 'AppletRegistered') {
    // Invalidate and refresh unjoined applets
    this.unjoinedApplets.reload();
  }
  if (signal.type === 'AssetRelationUpdated') {
    // Update specific asset store instead of polling all
    this._assetStores[signal.wal]?.store.reload();
  }
});
```

**Impact:** Eliminates most polling, real-time updates, better scalability

---

### 3.2 Optimize Asset Relation Polling for Selected Tools
**Priority: MEDIUM**  
**Complexity: MEDIUM**  
**Files:** `src/renderer/src/groups/group-store.ts`

**Changes:**
- Only poll asset relations for assets currently visible/selected
- Pause polling for assets in hidden iframes
- Resume when asset becomes visible

**Impact:** Reduces network activity when multiple tools are installed but only one is active

---

### 3.3 Add Request Deduplication and Batching
**Priority: MEDIUM**  
**Complexity: MEDIUM**  
**Files:** `src/renderer/src/groups/group-store.ts`, `src/renderer/src/moss-store.ts`

**Changes:**
- Deduplicate concurrent requests for same data
- Batch multiple small requests into single calls
- Implement request queue with priority

**Implementation:**
```typescript
class RequestBatcher {
  private pending = new Map<string, Promise<any>>();
  
  async batch<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }
    const promise = fn().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
```

**Impact:** Reduces redundant network calls, improves efficiency

---

## Stage 4: Long-Term Architectural Improvements
**Estimated Time: 1-2 months**  
**Expected Impact: Better maintainability + 10-20% additional improvement**

### 4.1 Refactor Store Architecture
**Priority: LOW-MEDIUM**  
**Complexity: HIGH**  
**Files:** All store-related files

**Changes:**
- Implement unified store pattern with proper caching layers
- Add store-level memoization and invalidation
- Create store composition utilities

**Impact:** Better code maintainability, easier to optimize in future

---

### 4.2 Implement Service Worker for Background Processing
**Priority: LOW**  
**Complexity: HIGH**  
**Files:** New service worker files

**Changes:**
- Move heavy data processing to service worker
- Cache responses more aggressively
- Prefetch likely-needed data

**Impact:** Offloads main thread, better background performance

---

## Recommended Implementation Order

### Phase 1 (Week 1): Quick Wins
1. ✅ 1.1 - Memoize Data Transformations (1 day)
2. ✅ 1.2 - Increase Polling Intervals (0.5 day)
3. ✅ 1.3 - Visibility-Based Polling (1 day)

**Total: ~2.5 days, immediate 30-40% improvement**

### Phase 2 (Weeks 2-3): Medium Optimizations (Common Case Focus)
1. ✅ 2.1a - Add Background Processing Support to Weave API (CRITICAL PREREQUISITE - 1-2 weeks)
2. ✅ 2.1b - Only Render Selected Applet (CRITICAL - 2-3 days, requires 2.1a)
3. ✅ 2.2 - Move Async Processing to Stores (LOW VALUE - skip or defer)
4. ✅ 2.3 - Request-Based Polling (2-3 days)
5. ✅ 2.4 - Consolidate StoreSubscribers (2 days)

**Total: ~2-3 weeks (including Weave API work), additional 50-70% improvement for common case**

**Note:** 2.1a requires coordination with Weave API team and may need to be done in parallel or before other Phase 2 work.

### Phase 3 (Weeks 4-6): Advanced Optimizations
1. ✅ 3.1 - Reactive Subscriptions (1-2 weeks)
2. ✅ 3.2 - Optimize Asset Relation Polling (3-5 days)
3. ✅ 3.3 - Request Deduplication (2-3 days)

**Total: ~2-3 weeks, additional 20-30% improvement**

### Phase 4 (Months 2-3): Long-Term
- 4.1 - Store Architecture Refactor
- 4.2 - Service Worker Implementation

---

## Success Metrics

Track these metrics before and after each phase:

1. **Network Requests per Minute**: Should decrease by 50-70% after Phase 1-2
2. **Time to Interactive**: Should improve by 30-50% after Phase 1-2
3. **CPU Usage (Idle)**: Should decrease by 40-60% after Phase 1-2
4. **Memory Usage**: Should stabilize after Phase 2
5. **Render Time**: Should decrease by 50-70% after Phase 1-2
6. **User-Reported Lag**: Should be eliminated after Phase 2

---

## Risk Mitigation

1. **Feature Flags**: Implement each optimization behind a feature flag
2. **Gradual Rollout**: Test each phase with small user group first
3. **Monitoring**: Add performance monitoring before starting
4. **Rollback Plan**: Keep ability to revert each change independently

---

## Notes

- Start with Phase 1 for immediate impact with minimal risk
- Phase 2 provides the biggest architectural improvements
- Phase 3 requires more testing but provides best long-term scalability
- Phase 4 is optional and can be done incrementally

Each phase builds on the previous, so order matters. Don't skip phases, but you can delay Phase 4 if needed.

