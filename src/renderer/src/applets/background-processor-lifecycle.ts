import { Readable, readable, writable, get } from '@holochain-open-dev/stores';
import { DnaHash } from '@holochain/client';
import { BackgroundProcessorLifecycle } from '@theweave/api';

/**
 * Creates a lifecycle manager for a background processor
 */
export function createBackgroundProcessorLifecycle(
    _groupDnaHash: DnaHash,
    _mossStore?: any, // Optional for now, can be enhanced later
): BackgroundProcessorLifecycle {
    // Track app visibility
    const isAppVisible = writable(!document.hidden);

    const handleVisibilityChange = () => {
        isAppVisible.set(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Track group active state - this would need to be updated when groups change
    // For now, we'll assume the group is active if it's the current group
    const isGroupActive = readable<boolean>(true, (set) => {
        // TODO: Subscribe to active group changes in mossStore
        // For now, default to true
        set(true);
    });

    // Track resource state - for now, always normal
    // TODO: Implement actual resource monitoring
    const resourceState = readable<'normal' | 'constrained' | 'critical'>('normal', (set) => {
        // TODO: Monitor system resources and update state
        set('normal');
    });

    // Lifecycle change callback system
    const lifecycleCallbacks: Array<(state: {
        isAppVisible: boolean;
        isGroupActive: boolean;
        resourceState: 'normal' | 'constrained' | 'critical';
    }) => void> = [];

    // Subscribe to all state changes and notify callbacks
    isAppVisible.subscribe((visible) => {
        notifyLifecycleCallbacks({
            isAppVisible: visible,
            isGroupActive: get(isGroupActive),
            resourceState: get(resourceState),
        });
    });

    isGroupActive.subscribe((active) => {
        notifyLifecycleCallbacks({
            isAppVisible: get(isAppVisible),
            isGroupActive: active,
            resourceState: get(resourceState),
        });
    });

    resourceState.subscribe((state) => {
        notifyLifecycleCallbacks({
            isAppVisible: get(isAppVisible),
            isGroupActive: get(isGroupActive),
            resourceState: state,
        });
    });

    function notifyLifecycleCallbacks(state: {
        isAppVisible: boolean;
        isGroupActive: boolean;
        resourceState: 'normal' | 'constrained' | 'critical';
    }) {
        lifecycleCallbacks.forEach((callback) => {
            try {
                callback(state);
            } catch (e) {
                console.error('Error in lifecycle callback:', e);
            }
        });
    }

    return {
        isAppVisible: isAppVisible as Readable<boolean>,
        isGroupActive,
        resourceState,
        onLifecycleChange: (callback) => {
            lifecycleCallbacks.push(callback);

            // Call immediately with current state
            callback({
                isAppVisible: get(isAppVisible),
                isGroupActive: get(isGroupActive),
                resourceState: get(resourceState),
            });

            // Return unsubscribe function
            return () => {
                const index = lifecycleCallbacks.indexOf(callback);
                if (index > -1) {
                    lifecycleCallbacks.splice(index, 1);
                }
            };
        },
    };
}

