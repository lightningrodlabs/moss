# Background Processing Performance Measurement Guide

This guide explains how to measure the performance benefits of the Background Processing Proposal, including what the existing performance logger can measure and what additional tools are needed.

## What Needs to Be Measured

The background processor proposal's main benefits are:

1. **Memory Usage** - 70-85% reduction (15-45 MB vs 50-150 MB for 10 applets)
2. **CPU Usage** - 50-70% reduction (background processors vs full iframes)
3. **Number of Iframes** - Count of loaded iframes (10 full vs 10 background + 1 main)
4. **Resource Efficiency** - Comparison of background processors vs full iframes
5. **Lifecycle Throttling** - Effectiveness of throttling when app/group inactive

## What the Performance Logger CAN Measure

The existing `PerformanceLogger` utility (`src/renderer/src/utils/performance-logger.ts`) is **useful for**:

### 1. Timing Within Background Processors

```typescript
// In background processor function
backgroundProcessor: async (weaveClient, appletClient, profilesClient, lifecycle) => {
  perfLogger.start('background-sync-cycle');
  
  const updates = await appletClient.callZome({
    role_name: 'forum',
    zome_name: 'posts',
    fn_name: 'get_recent_updates',
    payload: { since: lastSyncTime },
  });
  
  perfLogger.log('background-sync-cycle');
  // Logs: [PERF] background-sync-cycle: 234.56ms
}
```

**Useful for:**
- Measuring sync interval execution time
- Comparing processing time before/after optimization
- Identifying slow operations within processors
- Tracking lifecycle state change response times

### 2. Lifecycle State Changes

```typescript
lifecycle.onLifecycleChange((state) => {
  perfLogger.start('lifecycle-state-change');
  updateSyncInterval();
  perfLogger.log('lifecycle-state-change');
});
```

**Useful for:**
- Measuring how quickly processors respond to lifecycle changes
- Comparing throttling effectiveness

### 3. Background Processor Initialization

```typescript
// When background processor starts
perfLogger.start('background-processor-init');
// ... initialization code ...
perfLogger.log('background-processor-init');
```

**Useful for:**
- Measuring startup time of background processors
- Comparing initialization time vs full iframe load time

## What the Performance Logger CANNOT Measure

The existing logger **cannot measure** the main benefits:

### 1. Memory Usage ❌

**Why:** The logger only measures time, not memory.

**What's needed:**
- Browser Performance API: `performance.memory` (Chrome only, deprecated)
- Performance Observer API: `PerformanceObserver` with `entryTypes: ['measure', 'navigation']`
- DevTools Memory Profiler (manual)
- Custom memory tracking using `performance.measureUserAgentSpecificMemory()` (experimental)

### 2. CPU Usage ❌

**Why:** JavaScript cannot directly measure CPU usage.

**What's needed:**
- Browser DevTools Performance tab (manual profiling)
- Performance API: `performance.now()` for task duration (indirect)
- Long Task API: `PerformanceObserver` with `entryTypes: ['longtask']`
- System-level monitoring tools

### 3. Iframe Count ❌

**Why:** The logger doesn't track DOM elements.

**What's needed:**
- Custom tracking: `getAllIframes().length`
- IframeStore tracking: `mossStore.iframeStore.appletIframes`

### 4. System Resource State ❌

**Why:** The logger doesn't track system-level metrics.

**What's needed:**
- Custom resource monitoring
- Performance API for frame rate
- Memory pressure API (experimental)

## Recommended Measurement Approach

### Method 1: Extended Performance Logger (Recommended)

Extend the existing logger to track additional metrics:

```typescript
// Extended performance logger
interface ResourceMetrics {
  iframeCount: number;
  memoryUsage?: number; // If available
  timestamp: number;
}

class ExtendedPerformanceLogger extends PerformanceLogger {
  private resourceSnapshots: ResourceMetrics[] = [];
  
  snapshotResources(getAllIframes: () => HTMLIFrameElement[]): void {
    const snapshot: ResourceMetrics = {
      iframeCount: getAllIframes().length,
      memoryUsage: (performance as any).memory?.usedJSHeapSize,
      timestamp: performance.now(),
    };
    this.resourceSnapshots.push(snapshot);
  }
  
  getResourceSummary(): {
    avgIframeCount: number;
    maxIframeCount: number;
    minIframeCount: number;
    memoryTrend?: number[];
  } {
    const iframeCounts = this.resourceSnapshots.map(s => s.iframeCount);
    return {
      avgIframeCount: iframeCounts.reduce((a, b) => a + b, 0) / iframeCounts.length,
      maxIframeCount: Math.max(...iframeCounts),
      minIframeCount: Math.min(...iframeCounts),
      memoryTrend: this.resourceSnapshots.map(s => s.memoryUsage).filter(Boolean) as number[],
    };
  }
}
```

### Method 2: Browser DevTools (Most Accurate)

**For Memory:**
1. Open DevTools > Memory tab
2. Take heap snapshot before optimization
3. Take heap snapshot after optimization
4. Compare: Look for iframe-related memory

**For CPU:**
1. Open DevTools > Performance tab
2. Record before optimization (with all iframes loaded)
3. Record after optimization (with background processors)
4. Compare: CPU usage, frame rate, long tasks

**For Iframe Count:**
1. Use Console: `getAllIframes().length`
2. Or: `document.querySelectorAll('iframe').length`

### Method 3: Custom Measurement Utility

Create a dedicated measurement utility for background processors:

```typescript
// src/renderer/src/utils/background-processor-metrics.ts
export class BackgroundProcessorMetrics {
  private measurements: {
    timestamp: number;
    iframeCount: number;
    mainViewIframes: number;
    backgroundProcessorIframes: number;
    memoryUsage?: number;
  }[] = [];
  
  snapshot(mossStore: MossStore): void {
    const allIframes = getAllIframes();
    const appletIframes = Object.keys(mossStore.iframeStore.appletIframes);
    
    // Count iframes by type (would need to track iframe type)
    const mainViewIframes = /* count main view iframes */;
    const backgroundProcessorIframes = /* count background processor iframes */;
    
    this.measurements.push({
      timestamp: performance.now(),
      iframeCount: allIframes.length,
      mainViewIframes,
      backgroundProcessorIframes,
      memoryUsage: (performance as any).memory?.usedJSHeapSize,
    });
  }
  
  getComparison(): {
    before: { avgIframes: number; avgMemory?: number };
    after: { avgIframes: number; avgMemory?: number };
    improvement: { iframeReduction: number; memoryReduction?: number };
  } {
    // Compare before/after measurements
  }
}
```

## Measurement Plan

### Before Implementation (Baseline)

1. **Memory:**
   - Use DevTools Memory tab
   - Take heap snapshot with 10 applets loaded
   - Record total memory usage

2. **CPU:**
   - Use DevTools Performance tab
   - Record 30 seconds of activity
   - Note CPU usage percentage

3. **Iframe Count:**
   ```javascript
   // In console
   console.log('Iframes:', getAllIframes().length);
   console.log('Applet iframes:', Object.keys(mossStore.iframeStore.appletIframes).length);
   ```

4. **Timing (using performance logger):**
   ```typescript
   perfLogger.start('applet-load-all');
   // Load all applets
   perfLogger.log('applet-load-all');
   ```

### After Implementation

1. **Memory:**
   - Take heap snapshot with 10 background processors + 1 main view
   - Compare to baseline

2. **CPU:**
   - Record 30 seconds with background processors active
   - Compare CPU usage

3. **Iframe Count:**
   ```javascript
   // Should show: 11 iframes (10 background + 1 main) vs 10 before
   console.log('Iframes:', getAllIframes().length);
   ```

4. **Timing:**
   ```typescript
   perfLogger.start('background-processor-init');
   // Initialize background processors
   perfLogger.log('background-processor-init');
   
   perfLogger.start('main-view-load');
   // Load main view
   perfLogger.log('main-view-load');
   ```

### Lifecycle Throttling Measurement

```typescript
// Measure sync interval changes
lifecycle.onLifecycleChange((state) => {
  perfLogger.start('lifecycle-throttle');
  updateSyncInterval();
  perfLogger.log('lifecycle-throttle');
  
  // Log current state
  console.log('Lifecycle state:', {
    isAppVisible: state.isAppVisible,
    isGroupActive: state.isGroupActive,
    resourceState: state.resourceState,
    syncInterval: syncIntervalMs,
  });
});
```

## Quick Test Script

Add to browser console for quick measurements:

```javascript
// Measure iframe count and memory
function measureBackgroundProcessorBenefits() {
  const iframes = getAllIframes();
  const memory = performance.memory?.usedJSHeapSize;
  
  console.log('=== Background Processor Metrics ===');
  console.log('Total iframes:', iframes.length);
  console.log('Memory usage:', memory ? `${(memory / 1024 / 1024).toFixed(2)} MB` : 'N/A');
  
  // Count by type (would need iframe tracking)
  const mainViews = iframes.filter(/* is main view */).length;
  const backgroundProcessors = iframes.filter(/* is background processor */).length;
  
  console.log('Main view iframes:', mainViews);
  console.log('Background processor iframes:', backgroundProcessors);
  
  return {
    totalIframes: iframes.length,
    mainViews,
    backgroundProcessors,
    memoryMB: memory ? memory / 1024 / 1024 : undefined,
  };
}

// Run before and after
const before = measureBackgroundProcessorBenefits();
// ... implement background processors ...
const after = measureBackgroundProcessorBenefits();

console.log('Improvement:', {
  iframeReduction: before.totalIframes - after.totalIframes,
  memoryReduction: before.memoryMB && after.memoryMB 
    ? `${((before.memoryMB - after.memoryMB) / before.memoryMB * 100).toFixed(1)}%`
    : 'N/A',
});
```

## Conclusion

**The existing performance logger is useful for:**
- ✅ Timing operations within background processors
- ✅ Measuring lifecycle state change response times
- ✅ Tracking initialization and sync times

**But you'll also need:**
- ❌ Browser DevTools for memory/CPU measurements
- ❌ Custom tracking for iframe counts
- ❌ Extended logger or custom utility for resource metrics

**Recommendation:** Use the performance logger for timing measurements, and combine it with DevTools and custom tracking for a complete picture of the benefits.

## Related Documents

- [Performance Logger](../src/renderer/src/utils/performance-logger.ts) - Existing utility
- [Background Processing Proposal](./BACKGROUND_PROCESSING_PROPOSAL.md) - Implementation details
- [Background Processing Performance Analysis](./BACKGROUND_PROCESSING_PERFORMANCE_ANALYSIS.md) - Expected benefits

