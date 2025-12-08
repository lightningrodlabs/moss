import { getAllIframes } from '../utils.js';
import { MossStore } from '../moss-store.js';
import { GroupStore } from '../groups/group-store.js';
import { perfLogger } from './performance-logger.js';
import { get } from '@holochain-open-dev/stores';

/**
 * Resource metrics snapshot at a point in time
 */
export interface ResourceMetrics {
    timestamp: number;
    iframeCount: number;
    appletIframeCount: number;
    backgroundProcessorIframeCount: number;
    mainViewIframeCount: number;
    memoryUsage?: number; // in bytes
    appletsLoaded: number;
    appletsWithBackgroundProcessors: number;
}

/**
 * Lifecycle state snapshot
 */
export interface LifecycleState {
    timestamp: number;
    isAppVisible: boolean;
    isGroupActive: boolean;
    resourceState: 'normal' | 'constrained' | 'critical';
}

/**
 * Comparison results between before and after measurements
 */
export interface ComparisonResults {
    iframeReduction: {
        total: number;
        percentage: number;
        mainViewReduction: number;
        mainViewReductionPercentage: number;
    };
    memoryReduction?: {
        bytes: number;
        percentage: number;
        mb: number;
    };
    timingImprovements: {
        [metricName: string]: {
            before: number;
            after: number;
            improvement: number;
            improvementPercentage: number;
        };
    };
    summary: {
        avgIframeCount: { before: number; after: number };
        maxIframeCount: { before: number; after: number };
        avgMemoryMB?: { before: number; after: number };
    };
}

/**
 * Extended performance logger that tracks resource metrics
 * for background processor performance measurement
 */
export class BackgroundProcessorMetrics {
    private resourceSnapshots: ResourceMetrics[] = [];
    private lifecycleSnapshots: LifecycleState[] = [];
    private measurementPhase: 'before' | 'after' | null = null;

    /**
     * Start a measurement phase (before or after implementation)
     */
    startPhase(phase: 'before' | 'after'): void {
        this.measurementPhase = phase;
        this.resourceSnapshots = [];
        this.lifecycleSnapshots = [];
        perfLogger.clear();
        console.log(`[PERF] Started ${phase} measurement phase`);
    }

    /**
     * Take a snapshot of current resource state
     */
    snapshotResources(mossStore: MossStore, groupStore?: GroupStore): ResourceMetrics {
        const allIframes = getAllIframes();
        const appletIframes = Object.keys(mossStore.iframeStore.appletIframes);

        // Count iframes by type
        // Note: This will need to be updated once background processors are implemented
        // to distinguish between background processor iframes and main view iframes
        let backgroundProcessorIframeCount = 0;
        let mainViewIframeCount = 0;

        // For now, we'll need to track this differently once background processors are implemented
        // We can check iframe attributes or iframeStore metadata to distinguish types
        // For baseline measurements, all applet iframes are main views
        mainViewIframeCount = appletIframes.length;

        // Get applet count
        let appletsLoaded = 0;
        let appletsWithBackgroundProcessors = 0;

        if (groupStore) {
            const runningApplets = groupStore.allMyRunningApplets;
            const runningAppletsStatus = get(runningApplets);
            if (runningAppletsStatus && runningAppletsStatus.status === 'complete') {
                appletsLoaded = runningAppletsStatus.value.length;
                // TODO: Once background processors are implemented, check which applets have them
                // appletsWithBackgroundProcessors = Array.from(runningAppletsStatus.value)
                //   .filter(applet => applet.backgroundProcessor !== undefined).length;
            }
        }

        const snapshot: ResourceMetrics = {
            timestamp: performance.now(),
            iframeCount: allIframes.length,
            appletIframeCount: appletIframes.length,
            backgroundProcessorIframeCount,
            mainViewIframeCount,
            memoryUsage: (performance as any).memory?.usedJSHeapSize,
            appletsLoaded,
            appletsWithBackgroundProcessors,
        };

        this.resourceSnapshots.push(snapshot);
        return snapshot;
    }

    /**
     * Take a lifecycle state snapshot
     */
    snapshotLifecycle(state: {
        isAppVisible: boolean;
        isGroupActive: boolean;
        resourceState: 'normal' | 'constrained' | 'critical';
    }): void {
        this.lifecycleSnapshots.push({
            timestamp: performance.now(),
            ...state,
        });
    }

    /**
     * Get summary of resource metrics for current phase
     */
    getResourceSummary(): {
        avgIframeCount: number;
        maxIframeCount: number;
        minIframeCount: number;
        avgAppletIframeCount: number;
        avgBackgroundProcessorIframeCount: number;
        avgMainViewIframeCount: number;
        avgMemoryMB?: number;
        maxMemoryMB?: number;
        minMemoryMB?: number;
        memoryTrend?: number[];
        totalSnapshots: number;
    } {
        if (this.resourceSnapshots.length === 0) {
            return {
                avgIframeCount: 0,
                maxIframeCount: 0,
                minIframeCount: 0,
                avgAppletIframeCount: 0,
                avgBackgroundProcessorIframeCount: 0,
                avgMainViewIframeCount: 0,
                totalSnapshots: 0,
            };
        }

        const iframeCounts = this.resourceSnapshots.map(s => s.iframeCount);
        const appletIframeCounts = this.resourceSnapshots.map(s => s.appletIframeCount);
        const backgroundProcessorCounts = this.resourceSnapshots.map(s => s.backgroundProcessorIframeCount);
        const mainViewCounts = this.resourceSnapshots.map(s => s.mainViewIframeCount);
        const memoryValues = this.resourceSnapshots
            .map(s => s.memoryUsage)
            .filter((m): m is number => m !== undefined);

        return {
            avgIframeCount: iframeCounts.reduce((a, b) => a + b, 0) / iframeCounts.length,
            maxIframeCount: Math.max(...iframeCounts),
            minIframeCount: Math.min(...iframeCounts),
            avgAppletIframeCount: appletIframeCounts.reduce((a, b) => a + b, 0) / appletIframeCounts.length,
            avgBackgroundProcessorIframeCount: backgroundProcessorCounts.reduce((a, b) => a + b, 0) / backgroundProcessorCounts.length,
            avgMainViewIframeCount: mainViewCounts.reduce((a, b) => a + b, 0) / mainViewCounts.length,
            avgMemoryMB: memoryValues.length > 0
                ? memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length / 1024 / 1024
                : undefined,
            maxMemoryMB: memoryValues.length > 0
                ? Math.max(...memoryValues) / 1024 / 1024
                : undefined,
            minMemoryMB: memoryValues.length > 0
                ? Math.min(...memoryValues) / 1024 / 1024
                : undefined,
            memoryTrend: memoryValues.length > 0 ? memoryValues.map(m => m / 1024 / 1024) : undefined,
            totalSnapshots: this.resourceSnapshots.length,
        };
    }

    /**
     * Get timing metrics from performance logger
     */
    getTimingMetrics(): Record<string, { count: number; avg: number; max: number; min: number }> {
        return perfLogger.getSummary();
    }

    /**
     * Print summary of current phase
     */
    printSummary(): void {
        if (!this.measurementPhase) {
            console.warn('[PERF] No measurement phase active. Call startPhase() first.');
            return;
        }

        console.log(`\n[PERF] === ${this.measurementPhase.toUpperCase()} Phase Summary ===`);

        const resourceSummary = this.getResourceSummary();
        console.log('\n[PERF] Resource Metrics:');
        console.table({
            'Total Iframes': {
                'Average': resourceSummary.avgIframeCount.toFixed(1),
                'Max': resourceSummary.maxIframeCount,
                'Min': resourceSummary.minIframeCount,
            },
            'Applet Iframes': {
                'Average': resourceSummary.avgAppletIframeCount.toFixed(1),
            },
            'Background Processor Iframes': {
                'Average': resourceSummary.avgBackgroundProcessorIframeCount.toFixed(1),
            },
            'Main View Iframes': {
                'Average': resourceSummary.avgMainViewIframeCount.toFixed(1),
            },
            'Memory (MB)': {
                'Average': resourceSummary.avgMemoryMB?.toFixed(2) || 'N/A',
                'Max': resourceSummary.maxMemoryMB?.toFixed(2) || 'N/A',
                'Min': resourceSummary.minMemoryMB?.toFixed(2) || 'N/A',
            },
            'Snapshots': {
                'Count': resourceSummary.totalSnapshots,
            },
        });

        const timingMetrics = this.getTimingMetrics();
        if (Object.keys(timingMetrics).length > 0) {
            console.log('\n[PERF] Timing Metrics:');
            console.table(timingMetrics);
        }

        if (this.lifecycleSnapshots.length > 0) {
            const lifecycleSummary = {
                'App Visible': this.lifecycleSnapshots.filter(s => s.isAppVisible).length,
                'Group Active': this.lifecycleSnapshots.filter(s => s.isGroupActive).length,
                'Normal Resources': this.lifecycleSnapshots.filter(s => s.resourceState === 'normal').length,
                'Constrained Resources': this.lifecycleSnapshots.filter(s => s.resourceState === 'constrained').length,
                'Critical Resources': this.lifecycleSnapshots.filter(s => s.resourceState === 'critical').length,
            };
            console.log('\n[PERF] Lifecycle State Summary:');
            console.table(lifecycleSummary);
        }
    }

    /**
     * Compare before and after measurements
     * Note: This requires storing before measurements separately
     */
    compare(beforeMetrics: BackgroundProcessorMetrics): ComparisonResults {
        const beforeSummary = beforeMetrics.getResourceSummary();
        const afterSummary = this.getResourceSummary();

        const beforeTiming = beforeMetrics.getTimingMetrics();
        const afterTiming = this.getTimingMetrics();

        // Calculate iframe reduction
        const iframeReduction = {
            total: beforeSummary.avgIframeCount - afterSummary.avgIframeCount,
            percentage: beforeSummary.avgIframeCount > 0
                ? ((beforeSummary.avgIframeCount - afterSummary.avgIframeCount) / beforeSummary.avgIframeCount) * 100
                : 0,
            mainViewReduction: beforeSummary.avgMainViewIframeCount - afterSummary.avgMainViewIframeCount,
            mainViewReductionPercentage: beforeSummary.avgMainViewIframeCount > 0
                ? ((beforeSummary.avgMainViewIframeCount - afterSummary.avgMainViewIframeCount) / beforeSummary.avgMainViewIframeCount) * 100
                : 0,
        };

        // Calculate memory reduction
        let memoryReduction: ComparisonResults['memoryReduction'] = undefined;
        if (beforeSummary.avgMemoryMB && afterSummary.avgMemoryMB) {
            const reductionMB = beforeSummary.avgMemoryMB - afterSummary.avgMemoryMB;
            const reductionBytes = reductionMB * 1024 * 1024;
            memoryReduction = {
                bytes: reductionBytes,
                percentage: (reductionMB / beforeSummary.avgMemoryMB) * 100,
                mb: reductionMB,
            };
        }

        // Calculate timing improvements
        const timingImprovements: ComparisonResults['timingImprovements'] = {};
        const allMetricNames = new Set([
            ...Object.keys(beforeTiming),
            ...Object.keys(afterTiming),
        ]);

        allMetricNames.forEach(metricName => {
            const before = beforeTiming[metricName];
            const after = afterTiming[metricName];

            if (before && after) {
                const beforeAvg = before.avg;
                const afterAvg = after.avg;
                const improvement = beforeAvg - afterAvg;
                timingImprovements[metricName] = {
                    before: beforeAvg,
                    after: afterAvg,
                    improvement,
                    improvementPercentage: beforeAvg > 0 ? (improvement / beforeAvg) * 100 : 0,
                };
            }
        });

        return {
            iframeReduction,
            memoryReduction,
            timingImprovements,
            summary: {
                avgIframeCount: {
                    before: beforeSummary.avgIframeCount,
                    after: afterSummary.avgIframeCount,
                },
                maxIframeCount: {
                    before: beforeSummary.maxIframeCount,
                    after: afterSummary.maxIframeCount,
                },
                avgMemoryMB: beforeSummary.avgMemoryMB && afterSummary.avgMemoryMB
                    ? {
                        before: beforeSummary.avgMemoryMB,
                        after: afterSummary.avgMemoryMB,
                    }
                    : undefined,
            },
        };
    }

    /**
     * Print comparison results
     */
    printComparison(beforeMetrics: BackgroundProcessorMetrics): void {
        const comparison = this.compare(beforeMetrics);

        console.log('\n[PERF] === BEFORE/AFTER COMPARISON ===\n');

        console.log('[PERF] Iframe Reduction:');
        console.table({
            'Total Iframes': {
                'Before': comparison.summary.avgIframeCount.before.toFixed(1),
                'After': comparison.summary.avgIframeCount.after.toFixed(1),
                'Reduction': `${comparison.iframeReduction.total.toFixed(1)} (${comparison.iframeReduction.percentage.toFixed(1)}%)`,
            },
            'Main View Iframes': {
                'Before': comparison.summary.avgIframeCount.before.toFixed(1),
                'After': comparison.summary.avgIframeCount.after.toFixed(1),
                'Reduction': `${comparison.iframeReduction.mainViewReduction.toFixed(1)} (${comparison.iframeReduction.mainViewReductionPercentage.toFixed(1)}%)`,
            },
        });

        if (comparison.memoryReduction) {
            console.log('\n[PERF] Memory Reduction:');
            console.table({
                'Memory (MB)': {
                    'Before': comparison.summary.avgMemoryMB!.before.toFixed(2),
                    'After': comparison.summary.avgMemoryMB!.after.toFixed(2),
                    'Reduction': `${comparison.memoryReduction.mb.toFixed(2)} MB (${comparison.memoryReduction.percentage.toFixed(1)}%)`,
                },
            });
        }

        if (Object.keys(comparison.timingImprovements).length > 0) {
            console.log('\n[PERF] Timing Improvements:');
            const timingTable = Object.entries(comparison.timingImprovements).map(([name, data]) => ({
                'Metric': name,
                'Before (ms)': data.before.toFixed(2),
                'After (ms)': data.after.toFixed(2),
                'Improvement (ms)': data.improvement.toFixed(2),
                'Improvement (%)': `${data.improvementPercentage.toFixed(1)}%`,
            }));
            console.table(timingTable);
        }
    }

    /**
     * Export measurements as JSON for later analysis
     */
    export(): {
        phase: 'before' | 'after' | null;
        resourceSnapshots: ResourceMetrics[];
        lifecycleSnapshots: LifecycleState[];
        timingMetrics: Record<string, { count: number; avg: number; max: number; min: number }>;
    } {
        return {
            phase: this.measurementPhase,
            resourceSnapshots: this.resourceSnapshots,
            lifecycleSnapshots: this.lifecycleSnapshots,
            timingMetrics: this.getTimingMetrics(),
        };
    }

    /**
     * Import measurements from JSON
     */
    import(data: {
        phase: 'before' | 'after' | null;
        resourceSnapshots: ResourceMetrics[];
        lifecycleSnapshots: LifecycleState[];
    }): void {
        this.measurementPhase = data.phase;
        this.resourceSnapshots = data.resourceSnapshots;
        this.lifecycleSnapshots = data.lifecycleSnapshots;
    }

    /**
     * Clear all measurements
     */
    clear(): void {
        this.resourceSnapshots = [];
        this.lifecycleSnapshots = [];
        this.measurementPhase = null;
        perfLogger.clear();
    }
}

/**
 * Global instance for easy access
 */
export const backgroundProcessorMetrics = new BackgroundProcessorMetrics();

/**
 * Helper function to measure background processor benefits
 * Can be called from browser console
 */
export function measureBackgroundProcessorBenefits(mossStore: MossStore, groupStore?: GroupStore) {
    const snapshot = backgroundProcessorMetrics.snapshotResources(mossStore, groupStore);

    console.log('=== Background Processor Metrics ===');
    console.log('Total iframes:', snapshot.iframeCount);
    console.log('Applet iframes:', snapshot.appletIframeCount);
    console.log('Background processor iframes:', snapshot.backgroundProcessorIframeCount);
    console.log('Main view iframes:', snapshot.mainViewIframeCount);
    console.log('Memory usage:', snapshot.memoryUsage
        ? `${(snapshot.memoryUsage / 1024 / 1024).toFixed(2)} MB`
        : 'N/A');
    console.log('Applets loaded:', snapshot.appletsLoaded);
    console.log('Applets with background processors:', snapshot.appletsWithBackgroundProcessors);

    return snapshot;
}

