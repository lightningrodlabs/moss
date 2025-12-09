/**
 * Background Processor Measurement - Browser Console Script
 * 
 * Paste this script into the browser console to measure performance
 * before and after implementing background processors.
 * 
 * This script works independently and doesn't require app integration.
 * 
 * Usage:
 * 1. Before implementation: Run measureBefore()
 * 2. After implementation: Run measureAfter()
 * 3. Compare: Run compareResults()
 */

(function() {
  'use strict';

  // Storage for measurements
  const measurements = {
    before: null,
    after: null,
  };

  // Helper to get all iframes
  function getAllIframes() {
    const result = [];
    function traverse(node) {
      if (node.tagName === 'IFRAME') {
        result.push(node);
      }
      const shadowRoot = node.shadowRoot;
      if (shadowRoot) {
        shadowRoot.childNodes.forEach(traverse);
      }
      node.childNodes.forEach(traverse);
    }
    traverse(document.body);
    return result;
  }

  // Take a measurement snapshot
  function takeSnapshot(label) {
    const iframes = getAllIframes();
    const memory = performance.memory?.usedJSHeapSize;
    
    const snapshot = {
      timestamp: performance.now(),
      label: label,
      iframeCount: iframes.length,
      memoryMB: memory ? (memory / 1024 / 1024).toFixed(2) : 'N/A',
      memoryBytes: memory,
    };

    console.log(`[PERF] ${label} snapshot:`, snapshot);
    return snapshot;
  }

  // Complete before measurement
  window.measureBeforeComplete = function() {
    if (!measurements.before) {
      console.error('[PERF] No before measurement in progress. Call measureBefore() first.');
      return;
    }
    
    if (measurements.before.interval) {
      clearInterval(measurements.before.interval);
      measurements.before.interval = null;
    }
    
    measurements.before.snapshots.push(takeSnapshot('before-final'));
    measurements.before.endTime = performance.now();
    measurements.before.duration = measurements.before.endTime - measurements.before.startTime;
    
    const avgIframes = measurements.before.snapshots.reduce((sum, s) => sum + s.iframeCount, 0) / measurements.before.snapshots.length;
    const maxIframes = Math.max(...measurements.before.snapshots.map(s => s.iframeCount));
    const memorySnapshots = measurements.before.snapshots.filter(s => s.memoryBytes);
    const avgMemory = memorySnapshots.length > 0
      ? memorySnapshots.reduce((sum, s) => sum + s.memoryBytes, 0) / memorySnapshots.length
      : null;

    measurements.before.summary = {
      avgIframeCount: avgIframes.toFixed(1),
      maxIframeCount: maxIframes,
      avgMemoryMB: avgMemory ? (avgMemory / 1024 / 1024).toFixed(2) : 'N/A',
      duration: measurements.before.duration.toFixed(2) + 'ms',
    };

    console.log('[PERF] BEFORE measurement complete!');
    console.table(measurements.before.summary);
    console.log('[PERF] Data saved. After implementation, call measureAfter()');
  };

  // Measure before implementation
  window.measureBefore = function() {
    console.log('[PERF] Starting BEFORE measurement...');
    console.log('[PERF] Navigate to a group with multiple applets, then call measureBeforeComplete()');
    
    measurements.before = {
      startTime: performance.now(),
      snapshots: [],
      interval: null,
    };

    // Take initial snapshot
    measurements.before.snapshots.push(takeSnapshot('before-initial'));

    // Set up periodic snapshots
    measurements.before.interval = setInterval(() => {
      measurements.before.snapshots.push(takeSnapshot('before-periodic'));
    }, 500);
  };

  // Complete after measurement
  window.measureAfterComplete = function() {
    if (!measurements.after) {
      console.error('[PERF] No after measurement in progress. Call measureAfter() first.');
      return;
    }
    
    if (measurements.after.interval) {
      clearInterval(measurements.after.interval);
      measurements.after.interval = null;
    }
    
    measurements.after.snapshots.push(takeSnapshot('after-final'));
    measurements.after.endTime = performance.now();
    measurements.after.duration = measurements.after.endTime - measurements.after.startTime;
    
    const avgIframes = measurements.after.snapshots.reduce((sum, s) => sum + s.iframeCount, 0) / measurements.after.snapshots.length;
    const maxIframes = Math.max(...measurements.after.snapshots.map(s => s.iframeCount));
    const memorySnapshots = measurements.after.snapshots.filter(s => s.memoryBytes);
    const avgMemory = memorySnapshots.length > 0
      ? memorySnapshots.reduce((sum, s) => sum + s.memoryBytes, 0) / memorySnapshots.length
      : null;

    measurements.after.summary = {
      avgIframeCount: avgIframes.toFixed(1),
      maxIframeCount: maxIframes,
      avgMemoryMB: avgMemory ? (avgMemory / 1024 / 1024).toFixed(2) : 'N/A',
      duration: measurements.after.duration.toFixed(2) + 'ms',
    };

    console.log('[PERF] AFTER measurement complete!');
    console.table(measurements.after.summary);
    console.log('[PERF] Call compareResults() to see comparison');
  };

  // Measure after implementation
  window.measureAfter = function() {
    console.log('[PERF] Starting AFTER measurement...');
    console.log('[PERF] Navigate to the same group, then call measureAfterComplete()');
    
    measurements.after = {
      startTime: performance.now(),
      snapshots: [],
      interval: null,
    };

    // Take initial snapshot
    measurements.after.snapshots.push(takeSnapshot('after-initial'));

    // Set up periodic snapshots
    measurements.after.interval = setInterval(() => {
      measurements.after.snapshots.push(takeSnapshot('after-periodic'));
    }, 500);
  };

  // Compare before and after
  window.compareResults = function() {
    if (!measurements.before || !measurements.after) {
      console.error('[PERF] Need both before and after measurements. Run measureBefore() and measureAfter() first.');
      return;
    }

    const before = measurements.before.summary;
    const after = measurements.after.summary;

    const iframeReduction = parseFloat(before.avgIframeCount) - parseFloat(after.avgIframeCount);
    const iframeReductionPercent = (iframeReduction / parseFloat(before.avgIframeCount) * 100).toFixed(1);

    let memoryReduction = 'N/A';
    let memoryReductionPercent = 'N/A';
    if (before.avgMemoryMB !== 'N/A' && after.avgMemoryMB !== 'N/A') {
      const beforeMB = parseFloat(before.avgMemoryMB);
      const afterMB = parseFloat(after.avgMemoryMB);
      const reductionMB = beforeMB - afterMB;
      memoryReduction = reductionMB.toFixed(2) + ' MB';
      memoryReductionPercent = ((reductionMB / beforeMB) * 100).toFixed(1) + '%';
    }

    console.log('\n[PERF] === BEFORE/AFTER COMPARISON ===\n');
    console.table({
      'Metric': [
        'Average Iframe Count',
        'Max Iframe Count',
        'Average Memory (MB)',
        'Measurement Duration',
      ],
      'Before': [
        before.avgIframeCount,
        before.maxIframeCount,
        before.avgMemoryMB,
        before.duration,
      ],
      'After': [
        after.avgIframeCount,
        after.maxIframeCount,
        after.avgMemoryMB,
        after.duration,
      ],
      'Change': [
        `${iframeReduction > 0 ? '-' : '+'}${Math.abs(iframeReduction).toFixed(1)} (${iframeReductionPercent}%)`,
        (before.maxIframeCount - after.maxIframeCount) + '',
        memoryReduction + ' (' + memoryReductionPercent + ')',
        ((parseFloat(after.duration) - parseFloat(before.duration)) / 1000).toFixed(2) + 's',
      ],
    });

    console.log('\n[PERF] Expected improvements:');
    console.log('  - Memory: 70-85% reduction');
    console.log('  - CPU: 50-70% reduction during setup');
    console.log('  - Main view iframes: Significant reduction');
    console.log('  - Background processor iframes: New (lightweight)');
  };

  // Export measurements as JSON
  window.exportMeasurements = function() {
    const data = JSON.stringify(measurements, null, 2);
    console.log('[PERF] Measurements JSON:');
    console.log(data);
    return data;
  };

  // Import measurements from JSON
  window.importMeasurements = function(jsonString) {
    try {
      measurements = JSON.parse(jsonString);
      console.log('[PERF] Measurements imported successfully');
    } catch (e) {
      console.error('[PERF] Failed to import measurements:', e);
    }
  };

  // Stop current measurement (without completing)
  window.stopMeasurement = function() {
    if (measurements.before && measurements.before.interval) {
      clearInterval(measurements.before.interval);
      measurements.before.interval = null;
      console.log('[PERF] Stopped before measurement. Call measureBeforeComplete() to finalize.');
    }
    if (measurements.after && measurements.after.interval) {
      clearInterval(measurements.after.interval);
      measurements.after.interval = null;
      console.log('[PERF] Stopped after measurement. Call measureAfterComplete() to finalize.');
    }
    if (!measurements.before?.interval && !measurements.after?.interval) {
      console.log('[PERF] No active measurement to stop.');
    }
  };

  // Quick single measurement
  window.quickMeasure = function() {
    return takeSnapshot('quick');
  };

  console.log('[PERF] Background Processor Measurement Script Loaded!');
  console.log('[PERF] Available functions:');
  console.log('  - measureBefore() - Start before measurement');
  console.log('  - measureBeforeComplete() - Complete before measurement');
  console.log('  - measureAfter() - Start after measurement');
  console.log('  - measureAfterComplete() - Complete after measurement');
  console.log('  - stopMeasurement() - Stop current measurement');
  console.log('  - compareResults() - Compare before/after');
  console.log('  - quickMeasure() - Take a single snapshot');
  console.log('  - exportMeasurements() - Export as JSON');
  console.log('  - importMeasurements(jsonString) - Import from JSON');
})();

