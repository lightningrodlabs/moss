/**
 * Background Processor Measurement Script
 * 
 * This script provides utilities for measuring performance before and after
 * implementing background processors. It can be used in the browser console
 * or integrated into the application.
 * 
 * Usage:
 * 1. Before implementation: Run `startBeforeMeasurement()`
 * 2. After implementation: Run `startAfterMeasurement()`
 * 3. Compare: Run `printComparison()`
 */

import {
    backgroundProcessorMetrics,
    measureBackgroundProcessorBenefits,
    BackgroundProcessorMetrics,
} from './background-processor-metrics.js';
import { MossStore } from '../moss-store.js';
import { GroupStore } from '../groups/group-store.js';

/**
 * Global references for measurement (set by startMeasurement functions)
 */
let mossStoreRef: MossStore | null = null;
let groupStoreRef: GroupStore | null = null;
let snapshotInterval: number | null = null;

/**
 * Start measurement phase (before or after implementation)
 */
export function startMeasurement(
    phase: 'before' | 'after',
    mossStore: MossStore,
    groupStore?: GroupStore,
    snapshotIntervalMs: number = 500,
): void {
    mossStoreRef = mossStore;
    groupStoreRef = groupStore || null;

    backgroundProcessorMetrics.startPhase(phase);

    // Take initial snapshot
    backgroundProcessorMetrics.snapshotResources(mossStore, groupStore);

    // Set up periodic snapshots
    if (snapshotInterval) {
        clearInterval(snapshotInterval);
    }

    snapshotInterval = window.setInterval(() => {
        if (mossStoreRef) {
            backgroundProcessorMetrics.snapshotResources(mossStoreRef, groupStoreRef || undefined);
        }
    }, snapshotIntervalMs);

    console.log(`[PERF] Started ${phase} measurement phase. Taking snapshots every ${snapshotIntervalMs}ms.`);
    console.log('[PERF] Call stopMeasurement() when done, then printSummary() to see results.');
}

/**
 * Stop current measurement phase
 */
export function stopMeasurement(): void {
    if (snapshotInterval) {
        clearInterval(snapshotInterval);
        snapshotInterval = null;
    }
    console.log('[PERF] Stopped measurement. Call printSummary() to see results.');
}

/**
 * Print summary of current measurement phase
 */
export function printSummary(): void {
    backgroundProcessorMetrics.printSummary();
}

/**
 * Print comparison between before and after measurements
 * Requires that before measurements were saved
 */
export function printComparison(beforeMetricsData?: any): void {
    if (beforeMetricsData) {
        // Import before metrics if provided
        const beforeMetrics = new BackgroundProcessorMetrics();
        beforeMetrics.import(beforeMetricsData);
        backgroundProcessorMetrics.printComparison(beforeMetrics);
    } else {
        console.warn('[PERF] No before metrics provided. Save before metrics using exportMetrics() first.');
    }
}

/**
 * Export current measurements as JSON (for saving before metrics)
 */
export function exportMetrics(): string {
    const data = backgroundProcessorMetrics.export();
    return JSON.stringify(data, null, 2);
}

/**
 * Import measurements from JSON (for loading before metrics)
 */
export function importMetrics(jsonData: string): void {
    const data = JSON.parse(jsonData);
    backgroundProcessorMetrics.import(data);
}

/**
 * Quick measurement function for console use
 */
export function quickMeasure(mossStore: MossStore, groupStore?: GroupStore) {
    return measureBackgroundProcessorBenefits(mossStore, groupStore);
}

/**
 * Automated measurement workflow
 * Measures for a specified duration and then prints summary
 */
export async function automatedMeasurement(
    phase: 'before' | 'after',
    mossStore: MossStore,
    groupStore: GroupStore | undefined,
    durationMs: number = 10000,
    snapshotIntervalMs: number = 500,
): Promise<void> {
    console.log(`[PERF] Starting automated ${phase} measurement for ${durationMs}ms...`);

    startMeasurement(phase, mossStore, groupStore, snapshotIntervalMs);

    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, durationMs));

    stopMeasurement();
    printSummary();

    console.log(`[PERF] Automated ${phase} measurement complete.`);
    console.log('[PERF] Export results using: exportMetrics()');
}

/**
 * Setup measurement helpers on window object for console access
 * Call this once to make measurement functions available globally
 */
export function setupConsoleHelpers(mossStore: MossStore, getGroupStore?: () => GroupStore | undefined): void {
    (window as any).__backgroundProcessorMeasurement = {
        startBefore: () => startMeasurement('before', mossStore, getGroupStore?.()),
        startAfter: () => startMeasurement('after', mossStore, getGroupStore?.()),
        stop: stopMeasurement,
        summary: printSummary,
        quickMeasure: () => quickMeasure(mossStore, getGroupStore?.()),
        export: exportMetrics,
        import: importMetrics,
        compare: printComparison,
        automated: (phase: 'before' | 'after', durationMs: number = 10000) =>
            automatedMeasurement(phase, mossStore, getGroupStore?.(), durationMs),
    };

    console.log('[PERF] Measurement helpers available at window.__backgroundProcessorMeasurement');
    console.log('[PERF] Available functions:');
    console.log('  - startBefore() - Start before measurement');
    console.log('  - startAfter() - Start after measurement');
    console.log('  - stop() - Stop current measurement');
    console.log('  - summary() - Print summary of current phase');
    console.log('  - quickMeasure() - Take a single snapshot');
    console.log('  - export() - Export measurements as JSON');
    console.log('  - import(jsonString) - Import measurements from JSON');
    console.log('  - compare(beforeMetricsJson) - Compare before/after');
    console.log('  - automated(phase, durationMs) - Run automated measurement');
}

