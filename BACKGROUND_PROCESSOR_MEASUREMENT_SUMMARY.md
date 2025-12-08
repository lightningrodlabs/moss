# Background Processor Measurement Summary

This document provides a quick reference for measuring performance before and after implementing background processors.

## Files Created

1. **`src/renderer/src/utils/background-processor-metrics.ts`**
   - Core metrics tracking class
   - Tracks iframe counts, memory usage, timing metrics, lifecycle state
   - Provides comparison functionality

2. **`src/renderer/src/utils/background-processor-measurement-script.ts`**
   - Helper functions for easy measurement
   - Console helpers setup
   - Automated measurement workflows

3. **`BACKGROUND_PROCESSOR_CONSOLE_SCRIPT.js`**
   - Standalone browser console script
   - Can be pasted directly into console
   - No app integration required

4. **`BACKGROUND_PROCESSOR_MEASUREMENT_USAGE.md`**
   - Detailed usage guide
   - Integration instructions
   - Troubleshooting

## Quick Start (3 Methods)

### Method 1: Standalone Console Script (Easiest)

1. Open browser console
2. Paste contents of `BACKGROUND_PROCESSOR_CONSOLE_SCRIPT.js`
3. Before implementation:
   ```javascript
   measureBefore();
   // Navigate to group, wait for applets to load
   measureBeforeComplete();
   ```
4. After implementation:
   ```javascript
   measureAfter();
   // Navigate to same group, wait for applets to load
   measureAfterComplete();
   compareResults();
   ```

### Method 2: Integrated Console Helpers

1. Add to app initialization:
   ```typescript
   import { setupConsoleHelpers } from './utils/background-processor-measurement-script.js';
   setupConsoleHelpers(mossStore, () => groupStore);
   ```

2. In browser console:
   ```javascript
   window.__backgroundProcessorMeasurement.startBefore();
   // ... wait ...
   window.__backgroundProcessorMeasurement.stop();
   window.__backgroundProcessorMeasurement.summary();
   const beforeData = window.__backgroundProcessorMeasurement.export();
   
   // After implementation:
   window.__backgroundProcessorMeasurement.startAfter();
   // ... wait ...
   window.__backgroundProcessorMeasurement.stop();
   window.__backgroundProcessorMeasurement.compare(beforeData);
   ```

### Method 3: Programmatic

```typescript
import { 
  startMeasurement, 
  stopMeasurement, 
  printSummary,
  printComparison,
  exportMetrics,
} from './utils/background-processor-measurement-script.js';

// Before
startMeasurement('before', mossStore, groupStore);
// ... wait ...
stopMeasurement();
const beforeData = exportMetrics();

// After
startMeasurement('after', mossStore, groupStore);
// ... wait ...
stopMeasurement();
printComparison(beforeData);
```

## What Gets Measured

### Resource Metrics
- Total iframe count
- Applet iframe count
- Background processor iframe count (after implementation)
- Main view iframe count
- Memory usage (Chrome/Edge only)
- Applets loaded count

### Timing Metrics
- Group setup time
- Running applets load time
- Applet store initialization time
- Applet iframe load time
- Background processor initialization time

### Lifecycle State
- App visibility
- Group active state
- Resource state (normal/constrained/critical)

## Expected Results

Based on `BACKGROUND_PROCESSING_PERFORMANCE_ANALYSIS.md`:

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Memory (10 applets) | 50-150 MB | 15-45 MB | 70-85% reduction |
| CPU during setup | High | Lower | 50-70% reduction |
| Main view iframes | ~10 | ~1 | 90% reduction |
| Background processor iframes | 0 | ~10 | New (lightweight) |
| Total iframes | ~10 | ~11 | Slight increase |

## Measurement Workflow

1. **Prepare test environment**
   - Group with 5-10 running applets
   - Clear cache
   - Close other tabs
   - Disable extensions

2. **Before measurement**
   - Start measurement
   - Navigate to group
   - Wait for all applets to load
   - Stop measurement
   - Export and save results

3. **Implement background processors**
   - Follow `BACKGROUND_PROCESSING_PROPOSAL.md`

4. **After measurement**
   - Use same test environment
   - Start measurement
   - Navigate to same group
   - Wait for all applets to load
   - Stop measurement
   - Compare with before results

## Key Metrics to Watch

1. **Memory Usage** - Should decrease 70-85%
2. **Main View Iframes** - Should decrease significantly (only 1 active)
3. **Background Processor Iframes** - Should appear (lightweight)
4. **Time to First Applet Ready** - Should improve (only 1 main view to load)
5. **Frame Rate** - Should stay smooth during setup

## Troubleshooting

- **Memory shows "N/A"**: Only available in Chrome/Edge. Use DevTools Memory tab.
- **Iframe counts wrong**: Wait for all applets to load before stopping measurement.
- **No improvement**: Verify background processors are implemented and lifecycle throttling works.

## Related Documents

- [Background Processing Measurement Guide](./BACKGROUND_PROCESSING_MEASUREMENT_GUIDE.md) - What can/cannot be measured
- [Background Processing Proposal](./BACKGROUND_PROCESSING_PROPOSAL.md) - Implementation details
- [Background Processing Performance Analysis](./BACKGROUND_PROCESSING_PERFORMANCE_ANALYSIS.md) - Expected benefits
- [Background Processor Measurement Usage](./BACKGROUND_PROCESSOR_MEASUREMENT_USAGE.md) - Detailed usage guide
- [Performance Measurement Guide](./PERFORMANCE_MEASUREMENT_GUIDE.md) - General performance measurement

