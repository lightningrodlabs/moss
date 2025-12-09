# Performance Measurement Guide for Tool Setup Time

This guide explains how to measure the setup time for tools (applets) when a group is loaded, and how to track performance improvements from optimizations.

## What to Measure

When a group is loaded, tools need to be set up and initialized. Key metrics to track:

1. **Time to Load Running Applets** - How long until all running applets are detected and loaded
2. **Time to Initialize Applet Stores** - How long until applet stores are ready
3. **Time to First Applet Ready** - How long until the first applet is ready to use
4. **Time to All Applets Ready** - How long until all applets are fully initialized
5. **Main Thread Blocking Time** - How much the setup process blocks the UI
6. **Iframe Creation Time** - How long it takes to create applet iframes
7. **Background Processor Setup Time** - How long to set up background processors (if implemented)

---

## Method 1: Browser DevTools Performance Profiler

### Steps:

1. **Open DevTools** (F12 or Cmd+Option+I)
2. **Go to Performance tab**
3. **Click Record** (circle icon)
4. **Navigate to a group** (or refresh the page)
5. **Wait for all tools to be set up**
6. **Stop recording**

### What to Look For:

- **Long Tasks** (red bars) - Tasks over 50ms that block the main thread
- **JavaScript execution time** - Time spent in `allMyRunningApplets`, `appletStores`, iframe creation
- **Network requests** - When applet assets are fetched
- **Frame rate** - Should stay at 60fps, drops indicate blocking
- **Memory allocation** - Memory spikes during applet loading

### Before Optimizations:
- You'll see long tasks during applet store initialization
- Multiple sequential iframe creations blocking the main thread
- Memory spikes as all iframes load simultaneously
- Frame rate drops during setup

### After Optimizations (Background Processing + 2.1b):
- Fewer long tasks (background processors load separately)
- Only one main view iframe created at a time
- Smoother frame rate during setup
- Lower memory usage (background processors vs full iframes)

---

## Method 2: Custom Performance Markers (Recommended)

Add performance markers to measure specific setup operations. This method is **already implemented** in the codebase.

### Implementation Details:

**In `group-store.ts`:**
- `GROUP_SETUP_START` marker is set in the `GroupStore` constructor
- `RUNNING_APPLETS_START` and `RUNNING_APPLETS_END` markers track the time to load running applets
- Measurements are logged to console with `[PERF]` prefix

**In `moss-store.ts`:**
- Individual applet store initialization is tracked per applet
- Slow applet store init (>100ms) is logged with a warning

**In `view-frame.ts` (where applet iframes are actually loaded):**
- Tracks when each applet iframe loads via the `@load` event
- Marks `FIRST_APPLET_READY` when the first applet iframe finishes loading
- Measures from `GROUP_SETUP_START` if available, otherwise falls back to navigation timing
- Uses a module-level `Set` to track which applets have been marked as ready

### Key Code Locations:

```typescript
// group-store.ts - Group setup and running applets tracking
constructor(...) {
  performance.mark(PERF_MARKERS.GROUP_SETUP_START);
  // ...
}

allMyRunningApplets = manualReloadStore(async () => {
  performance.mark(PERF_MARKERS.RUNNING_APPLETS_START);
  // ... load applets ...
  performance.mark(PERF_MARKERS.RUNNING_APPLETS_END);
  performance.measure('running-applets-load', ...);
  // Logs: [PERF] Running applets load: XXXms (N applets)
});

// moss-store.ts - Applet store initialization tracking
appletStores = new LazyHoloHashMap((appletHash: EntryHash) =>
  asyncReadable<AppletStore>(async (set) => {
    const appletStoreMarker = `applet-store-init-${encodeHashToBase64(appletHash)}`;
    performance.mark(`${appletStoreMarker}-start`);
    // ... create applet store ...
    performance.mark(`${appletStoreMarker}-end`);
    performance.measure(appletStoreMarker, ...);
    // Logs slow stores: [PERF] Slow applet store init: XXX took YYYms
  }),
);

// view-frame.ts - Applet iframe load tracking
handleIframeLoad() {
  this.loading = false;
  
  // Track when applet iframe is ready (for main applet views)
  if (this.renderView.type === 'applet-view' &&
      this.renderView.view.type === 'main' &&
      this.iframeKind.type === 'applet') {
    const appletId = encodeHashToBase64(this.iframeKind.appletHash);
    if (!readyApplets.has(appletId)) {
      readyApplets.add(appletId);
      
      // Check if this is the first applet ready
      if (readyApplets.size === 1) {
        performance.mark(PERF_MARKERS.FIRST_APPLET_READY);
        // Measures and logs: [PERF] First applet ready: XXXms
      }
    }
  }
}
```

### View Results:

The measurements are automatically logged to the console with `[PERF]` prefix. You can also query them programmatically:

```javascript
// In browser console - Get all performance measures
performance.getEntriesByType('measure').forEach(measure => {
  console.log(`${measure.name}: ${measure.duration.toFixed(2)}ms`);
});

// Get summary of key metrics
const measures = performance.getEntriesByType('measure');
const summary = {
  'running-applets-load': measures
    .filter(m => m.name === 'running-applets-load')
    .map(m => m.duration),
  'first-applet-ready': measures
    .filter(m => m.name === 'first-applet-ready')
    .map(m => m.duration),
  'applet-store-init': measures
    .filter(m => m.name.startsWith('applet-store-init-'))
    .map(m => m.duration),
};
console.table(summary);

// Get all applet store init times
const appletStoreMeasures = measures
  .filter(m => m.name.startsWith('applet-store-init-'))
  .map(m => ({
    appletHash: m.name.replace('applet-store-init-', ''),
    duration: m.duration.toFixed(2) + 'ms',
  }));
console.table(appletStoreMeasures);
```

### Console Output:

When you navigate to a group, you'll see console output like:
```
[PERF] Running applets load: 234.56ms (5 applets)
[PERF] First applet ready: 456.78ms
[PERF] Slow applet store init: uhCEk... took 234.56ms
```

**Note:** The `first-applet-ready` measurement is triggered when the first applet iframe's `@load` event fires in `view-frame.ts`, which is the actual point when the applet is ready to use.

---

## Method 3: Performance Logger Utility

Use the existing performance logger for consistent measurement:

### Add to `group-store.ts`:

```typescript
import { perfLogger } from '../utils/performance-logger.js';

// In GroupStore constructor:
constructor(...) {
  perfLogger.start('group-setup', {
    groupDnaHash: encodeHashToBase64(this.groupDnaHash),
  });
  // ... existing constructor code ...
}

// In allMyRunningApplets:
allMyRunningApplets = manualReloadStore(async () => {
  perfLogger.start('running-applets-load', {
    groupDnaHash: encodeHashToBase64(this.groupDnaHash),
  });
  
  const applets = await this.groupClient.getMyRunningApplets();
  
  perfLogger.log('running-applets-load');
  console.log(`[PERF] Loaded ${applets.size} running applets`);
  
  return applets;
});
```

### Add to `view-frame.ts` (if using performance logger):

```typescript
import { perfLogger } from '../../utils/performance-logger.js';

// Track applet iframe creation and loading
async firstUpdated() {
  if (this.mossStore.isAppletDev) {
    this.appletDevPort = await this.mossStore.getAppletDevPort(this.iframeKind);
  }
  
  // Track when iframe starts loading (for main applet views)
  if (
    this.renderView.type === 'applet-view' &&
    this.renderView.view.type === 'main' &&
    this.iframeKind.type === 'applet'
  ) {
    const appletId = encodeHashToBase64(this.iframeKind.appletHash);
    perfLogger.start(`applet-iframe-${appletId}`, {
      appletHash: appletId,
    });
  }
}

handleIframeLoad() {
  this.loading = false;
  
  // Track when applet iframe is ready
  if (
    this.renderView.type === 'applet-view' &&
    this.renderView.view.type === 'main' &&
    this.iframeKind.type === 'applet'
  ) {
    const appletId = encodeHashToBase64(this.iframeKind.appletHash);
    perfLogger.log(`applet-iframe-${appletId}`);
  }
}
```

**Note:** The current implementation uses the Performance API markers (Method 2) rather than the performance logger. The logger can be added if you prefer that approach.

### View Results:

```javascript
// In browser console:
perfLogger.printSummary();

// Get specific metrics
const metrics = perfLogger.getMetrics();
const setupMetrics = metrics.filter(m => 
  m.name.includes('group-setup') || 
  m.name.includes('running-applets') ||
  m.name.includes('applet-iframe')
);
console.table(setupMetrics);
```

---

## Method 4: Network Tab Analysis

### Steps:

1. **Open DevTools Network tab**
2. **Filter by "Fetch/XHR" and "Other"**
3. **Navigate to a group**
4. **Observe request patterns**

### What to Look For:

**Before Optimizations:**
- Many simultaneous requests for applet assets
- Requests blocking each other
- Long waterfall pattern
- All iframes loading assets at once

**After Optimizations:**
- Background processors load assets separately
- Only one main view loading assets at a time
- Better request timing
- Reduced concurrent requests

### Metrics:
- **Total requests** - Should be similar, but timing differs
- **Request duration** - Should be similar per request
- **Concurrent requests** - Should be lower (only one main view)
- **Waterfall pattern** - Should show sequential loading instead of parallel

---

## Method 5: Iframe Count and Memory Tracking

### Custom Measurement Utility:

```typescript
// src/renderer/src/utils/tool-setup-metrics.ts
import { getAllIframes } from './utils.js';
import { MossStore } from '../moss-store.js';

export class ToolSetupMetrics {
  private snapshots: Array<{
    timestamp: number;
    iframeCount: number;
    appletIframeCount: number;
    memoryUsage?: number;
    appletsReady: number;
  }> = [];
  
  snapshot(mossStore: MossStore, groupStore: GroupStore): void {
    const allIframes = getAllIframes();
    const appletIframes = Object.keys(mossStore.iframeStore.appletIframes);
    const runningApplets = groupStore.allMyRunningApplets.value;
    
    this.snapshots.push({
      timestamp: performance.now(),
      iframeCount: allIframes.length,
      appletIframeCount: appletIframes.length,
      memoryUsage: (performance as any).memory?.usedJSHeapSize,
      appletsReady: runningApplets?.status === 'complete' 
        ? runningApplets.value.size 
        : 0,
    });
  }
  
  getSummary(): {
    totalSetupTime: number;
    avgIframeCount: number;
    maxIframeCount: number;
    memoryIncrease: number;
    appletsReadyTime: number;
  } {
    if (this.snapshots.length < 2) {
      throw new Error('Need at least 2 snapshots');
    }
    
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    
    return {
      totalSetupTime: last.timestamp - first.timestamp,
      avgIframeCount: this.snapshots.reduce((sum, s) => sum + s.iframeCount, 0) / this.snapshots.length,
      maxIframeCount: Math.max(...this.snapshots.map(s => s.iframeCount)),
      memoryIncrease: last.memoryUsage && first.memoryUsage 
        ? last.memoryUsage - first.memoryUsage 
        : 0,
      appletsReadyTime: this.snapshots.find(s => s.appletsReady > 0)?.timestamp || 0,
    };
  }
  
  printSummary(): void {
    const summary = this.getSummary();
    console.table({
      'Total Setup Time': `${summary.totalSetupTime.toFixed(2)}ms`,
      'Average Iframe Count': summary.avgIframeCount.toFixed(1),
      'Max Iframe Count': summary.maxIframeCount,
      'Memory Increase': summary.memoryIncrease 
        ? `${(summary.memoryIncrease / 1024 / 1024).toFixed(2)} MB`
        : 'N/A',
      'Applets Ready Time': summary.appletsReadyTime 
        ? `${summary.appletsReadyTime.toFixed(2)}ms`
        : 'N/A',
    });
  }
}

export const toolSetupMetrics = new ToolSetupMetrics();
```

### Use in `group-container.ts`:

```typescript
import { toolSetupMetrics } from '../../utils/tool-setup-metrics.js';

async firstUpdated() {
  // Take initial snapshot
  toolSetupMetrics.snapshot(this._mossStore, this._groupStore);
  
  // Take periodic snapshots
  const snapshotInterval = setInterval(() => {
    toolSetupMetrics.snapshot(this._mossStore, this._groupStore);
  }, 100); // Every 100ms
  
  // Stop after 10 seconds
  setTimeout(() => {
    clearInterval(snapshotInterval);
    toolSetupMetrics.printSummary();
  }, 10000);
}
```

---

## Recommended Measurement Workflow

### Before Implementation:

1. **Set up measurement code** (Method 2 or 3 recommended)
2. **Test with a group that has 5-10 running applets**
3. **Record baseline metrics:**
   - Time to load running applets
   - Time to initialize applet stores
   - Time to first applet ready
   - Time to all applets ready
   - Number of iframes created
   - Memory usage during setup
   - Main thread blocking time
4. **Repeat 3-5 times** and average the results

### After Implementation:

1. **Keep the same measurement code**
2. **Test with the same group and same applets**
3. **Record new metrics**
4. **Compare results**

### Expected Improvements (with Background Processing + 2.1b):

- **70-85% reduction** in memory usage during setup
- **50-70% reduction** in CPU usage during setup
- **Faster time to first applet ready** (only one iframe to load)
- **Lower iframe count** (10 background processors + 1 main vs 10 full iframes)
- **Smoother frame rate** during setup (less blocking)
- **Better scalability** (setup time doesn't increase linearly with applet count)

---

## Quick Test Script

Add this to browser console for quick measurements:

```javascript
// Measure tool setup time
const startTime = performance.now();
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.entryType === 'measure') {
      console.log(`${entry.name}: ${entry.duration.toFixed(2)}ms`);
    }
  }
});
observer.observe({ entryTypes: ['measure'] });

// Track iframe count
let iframeCounts = [];
const iframeInterval = setInterval(() => {
  const iframes = document.querySelectorAll('iframe').length;
  iframeCounts.push({
    time: performance.now() - startTime,
    count: iframes,
  });
}, 100);

// Navigate to group, then after setup:
clearInterval(iframeInterval);
console.log('Iframe count over time:', iframeCounts);
console.log(`Total setup time: ${(performance.now() - startTime).toFixed(2)}ms`);

// Get all performance measures
const measures = performance.getEntriesByType('measure');
console.table(measures.map(m => ({
  name: m.name,
  duration: `${m.duration.toFixed(2)}ms`,
})));
```

---

## Tips

1. **Test with realistic data** - Use groups with 5-20 running applets
2. **Clear cache between tests** - Use DevTools > Application > Clear storage
3. **Disable extensions** - They can affect measurements
4. **Test on same machine** - Network conditions affect results
5. **Use Chrome/Edge** - Best DevTools for performance profiling
6. **Test multiple times** - Average results for accuracy
7. **Test with different applet counts** - See how setup time scales

---

## Success Criteria

Tool setup optimization is successful if:

- ✅ Setup time doesn't increase linearly with applet count
- ✅ Time to first applet ready is < 2 seconds (for 10 applets)
- ✅ No main thread blocking > 50ms during setup
- ✅ Frame rate stays at 60fps during setup
- ✅ Memory usage during setup is < 100 MB (for 10 applets)
- ✅ Background processors load without blocking main thread
- ✅ Only one main view iframe created at a time (after 2.1b)

---

## Related Documents

- [Performance Optimization Plan](./PERFORMANCE_OPTIMIZATION_PLAN.md) - Overall optimization strategy
- [Background Processing Proposal](./BACKGROUND_PROCESSING_PROPOSAL.md) - Background processor implementation
- [Background Processing Performance Analysis](./BACKGROUND_PROCESSING_PERFORMANCE_ANALYSIS.md) - Expected benefits
