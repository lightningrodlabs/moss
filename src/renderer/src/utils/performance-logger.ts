interface PerformanceMetric {
    name: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    metadata?: Record<string, any>;
}

class PerformanceLogger {
    private metrics: PerformanceMetric[] = [];
    private enabled: boolean = true;

    start(name: string, metadata?: Record<string, any>): void {
        if (!this.enabled) return;
        this.metrics.push({
            name,
            startTime: performance.now(),
            metadata,
        });
    }

    end(name: string): number | undefined {
        if (!this.enabled) return;
        const metric = this.metrics.find((m) => m.name === name && !m.endTime);
        if (metric) {
            metric.endTime = performance.now();
            metric.duration = metric.endTime - metric.startTime;
            return metric.duration;
        }
        return undefined;
    }

    log(name: string): void {
        const duration = this.end(name);
        if (duration !== undefined) {
            console.log(`[PERF] ${name}: ${duration.toFixed(2)}ms`);
        }
    }

    getMetrics(): PerformanceMetric[] {
        return this.metrics.filter((m) => m.duration !== undefined);
    }

    getSummary(): Record<string, { count: number; avg: number; max: number; min: number }> {
        const summary: Record<string, number[]> = {};
        this.getMetrics().forEach((m) => {
            if (!summary[m.name]) summary[m.name] = [];
            summary[m.name].push(m.duration!);
        });

        const result: Record<string, { count: number; avg: number; max: number; min: number }> = {};
        Object.entries(summary).forEach(([name, durations]) => {
            result[name] = {
                count: durations.length,
                avg: durations.reduce((a, b) => a + b, 0) / durations.length,
                max: Math.max(...durations),
                min: Math.min(...durations),
            };
        });
        return result;
    }

    printSummary(): void {
        const summary = this.getSummary();
        console.table(summary);
    }

    clear(): void {
        this.metrics = [];
    }

    enable(): void {
        this.enabled = true;
    }

    disable(): void {
        this.enabled = false;
    }
}

export const perfLogger = new PerformanceLogger();

