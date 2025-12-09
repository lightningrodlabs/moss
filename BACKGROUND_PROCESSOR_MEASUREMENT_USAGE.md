# Background Processor Measurement Usage Guide

This guide explains how to use the measurement utilities to compare performance before and after implementing background processors.

## Overview

The measurement system consists of:
1. **BackgroundProcessorMetrics** - Core metrics tracking class
2. **Measurement Script** - Helper functions for easy measurement
3. **Console Helpers** - Browser console utilities

## Quick Start

### Method 1: Browser Console (Recommended for Quick Tests)

1. **Set up console helpers** (add to your app initialization):
```typescript
import { setupConsoleHelpers } from './utils/background-processor-measurement-script.js';
import { mossStore } from './moss-store.js';

// In your app initialization
setupConsoleHelpers(mossStore, () => groupStore); // groupStore from context
```

2. **In browser console, run before measurement:**
```javascript
// Start before measurement (takes snapshots every 500ms)
window.__backgroundProcessorMeasurement.startBefore();

// Wait for applets to load, then stop
window.__backgroundProcessorMeasurement.stop();

// View summary
window.__backgroundProcessorMeasurement.summary();

// Export for later comparison
const beforeData = window.__backgroundProcessorMeasurement.export();
// Copy this JSON string and save it somewhere
```

3. **After implementing background processors, run after measurement:**
```javascript
// Start after measurement
window.__backgroundProcessorMeasurement.startAfter();

// Wait for applets to load, then stop
window.__backgroundProcessorMeasurement.stop();

// View summary
window.__backgroundProcessorMeasurement.summary();

// Compare with before (paste the beforeData JSON string)
window.__backgroundProcessorMeasurement.compare(beforeData);
```

### Method 2: Programmatic Measurement

```typescript
import { 
  backgroundProcessorMetrics,
  startMeasurement,
  stopMeasurement,
  printSummary,
  printComparison,
  exportMetrics,
  importMetrics,
} from './utils/background-processor-measurement-script.js';

// BEFORE IMPLEMENTATION
// Start before phase
startMeasurement('before', mossStore, groupStore, 500); // 500ms snapshot interval

// ... let applets load ...

// Stop and get summary
stopMeasurement();
printSummary();

// Export before metrics
const beforeMetricsJson = exportMetrics();
// Save this to a file or localStorage
localStorage.setItem('beforeMetrics', beforeMetricsJson);

// AFTER IMPLEMENTATION
// Load before metrics
const beforeMetricsJson = localStorage.getItem('beforeMetrics');
const beforeMetrics = JSON.parse(beforeMetricsJson);

// Start after phase
startMeasurement('after', mossStore, groupStore, 500);

// ... let applets load ...

// Stop and compare
stopMeasurement();
printSummary();

// Import before metrics and compare
importMetrics(beforeMetricsJson);
printComparison(beforeMetrics);
```

### Method 3: Automated Measurement

```typescript
import { automatedMeasurement } from './utils/background-processor-measurement-script.js';

// Before implementation
await automatedMeasurement('before', mossStore, groupStore, 10000); // 10 seconds
const beforeData = exportMetrics();

// After implementation
await automatedMeasurement('after', mossStore, groupStore, 10000);
const afterData = exportMetrics();

// Compare
importMetrics(beforeData);
printComparison(beforeData);
```

## What Gets Measured

### Resource Metrics

- **Total Iframe Count** - All iframes in the DOM
- **Applet Iframe Count** - Iframes for applets
- **Background Processor Iframe Count** - Iframes running background processors
- **Main View Iframe Count** - Iframes showing main applet views
- **Memory Usage** - JavaScript heap size (if available in Chrome)
- **Applets Loaded** - Number of applets currently loaded
- **Applets with Background Processors** - Number of applets that have background processors

### Timing Metrics

Uses the existing `perfLogger` to track:
- Group setup time
- Running applets load time
- Applet store initialization time
- Applet iframe load time
- Background processor initialization time
- Lifecycle state change response time

### Lifecycle State

Tracks:
- App visibility (isAppVisible)
- Group active state (isGroupActive)
- Resource state (normal/constrained/critical)

## Measurement Workflow

### Step 1: Baseline Measurement (Before Implementation)

1. **Prepare test environment:**
   - Use a group with 5-10 running applets
   - Clear browser cache
   - Close other tabs
   - Disable browser extensions

2. **Start measurement:**
   ```javascript
   window.__backgroundProcessorMeasurement.startBefore();
   ```

3. **Navigate to the group** (or refresh if already there)

4. **Wait for all applets to load** (watch console for completion)

5. **Stop measurement:**
   ```javascript
   window.__backgroundProcessorMeasurement.stop();
   ```

6. **View summary:**
   ```javascript
   window.__backgroundProcessorMeasurement.summary();
   ```

7. **Export and save:**
   ```javascript
   const beforeData = window.__backgroundProcessorMeasurement.export();
   // Copy this JSON and save it
   console.log(beforeData);
   ```

### Step 2: Implementation

Implement background processors according to `BACKGROUND_PROCESSING_PROPOSAL.md`.

### Step 3: After Measurement

1. **Use the same test environment:**
   - Same group
   - Same applets
   - Same browser conditions

2. **Start measurement:**
   ```javascript
   window.__backgroundProcessorMeasurement.startAfter();
   ```

3. **Navigate to the group**

4. **Wait for all applets to load**

5. **Stop measurement:**
   ```javascript
   window.__backgroundProcessorMeasurement.stop();
   ```

6. **View summary:**
   ```javascript
   window.__backgroundProcessorMeasurement.summary();
   ```

7. **Compare with before:**
   ```javascript
   // Paste the beforeData JSON string
   window.__backgroundProcessorMeasurement.compare(beforeData);
   ```

## Expected Results

Based on `BACKGROUND_PROCESSING_PERFORMANCE_ANALYSIS.md`, you should see:

### Iframe Count
- **Before:** ~10 iframes (one per applet)
- **After:** ~11 iframes (10 background processors + 1 main view)
- **Note:** The total increases slightly, but main view iframes decrease significantly

### Memory Usage
- **Before:** 50-150 MB for 10 applets
- **After:** 15-45 MB for 10 applets
- **Reduction:** 70-85%

### CPU Usage
- **Before:** High CPU during setup (all iframes loading)
- **After:** Lower CPU (background processors load separately)
- **Reduction:** 50-70% during setup

### Timing Improvements
- Faster time to first applet ready (only one main view to load)
- Smoother frame rate during setup
- Less main thread blocking

## Integration with Existing Performance Markers

The measurement system works alongside existing performance markers in:
- `group-store.ts` - Group setup and running applets
- `moss-store.ts` - Applet store initialization
- `view-frame.ts` - Applet iframe loading

All timing metrics from `perfLogger` are automatically included in comparisons.

## Advanced Usage

### Custom Snapshot Intervals

```typescript
// Take snapshots every 100ms for more detailed tracking
startMeasurement('before', mossStore, groupStore, 100);
```

### Manual Snapshots

```typescript
import { backgroundProcessorMetrics } from './utils/background-processor-metrics.js';

// Take a single snapshot
backgroundProcessorMetrics.snapshotResources(mossStore, groupStore);

// Take lifecycle snapshot
backgroundProcessorMetrics.snapshotLifecycle({
  isAppVisible: true,
  isGroupActive: true,
  resourceState: 'normal',
});
```

### Export/Import for Later Analysis

```typescript
// Export measurements
const data = backgroundProcessorMetrics.export();
const json = JSON.stringify(data, null, 2);

// Save to file or localStorage
localStorage.setItem('measurements', json);

// Later, import for comparison
const savedJson = localStorage.getItem('measurements');
const savedData = JSON.parse(savedJson);
backgroundProcessorMetrics.import(savedData);
```

### Programmatic Comparison

```typescript
import { BackgroundProcessorMetrics } from './utils/background-processor-metrics.js';

const beforeMetrics = new BackgroundProcessorMetrics();
beforeMetrics.import(beforeData);

const afterMetrics = new BackgroundProcessorMetrics();
afterMetrics.import(afterData);

const comparison = afterMetrics.compare(beforeMetrics);
console.log('Iframe reduction:', comparison.iframeReduction);
console.log('Memory reduction:', comparison.memoryReduction);
console.log('Timing improvements:', comparison.timingImprovements);
```

## Troubleshooting

### Memory metrics show "N/A"
- Memory API is only available in Chrome/Edge
- Use DevTools Memory tab for manual measurement

### Iframe counts seem wrong
- Make sure all iframes are loaded before taking snapshots
- Check that background processor iframes are properly tagged (once implemented)

### Timing metrics missing
- Ensure `perfLogger` is being used in relevant code paths
- Check that performance markers are set correctly

### Comparison shows no improvement
- Verify that background processors are actually implemented
- Check that main view iframes are being destroyed when not selected
- Ensure lifecycle throttling is working

## Related Documents

- [Background Processing Measurement Guide](./BACKGROUND_PROCESSING_MEASUREMENT_GUIDE.md) - What can and cannot be measured
- [Background Processing Proposal](./BACKGROUND_PROCESSING_PROPOSAL.md) - Implementation details
- [Background Processing Performance Analysis](./BACKGROUND_PROCESSING_PERFORMANCE_ANALYSIS.md) - Expected benefits
- [Performance Measurement Guide](./PERFORMANCE_MEASUREMENT_GUIDE.md) - General performance measurement

