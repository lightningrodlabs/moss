import { css, html, LitElement, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit/context';
import { IframeKind, RenderView, LifecycleState } from '@theweave/api';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import { mossStyles } from '../../shared-styles.js';
import { iframeOrigin, renderViewToQueryString } from '../../utils.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import { encode } from '@msgpack/msgpack';
import { fromUint8Array } from 'js-base64';

// Performance markers for tool setup measurement (Method 2)
const PERF_MARKERS = {
  GROUP_SETUP_START: 'group-setup-start',
  FIRST_APPLET_READY: 'first-applet-ready',
  ALL_APPLETS_READY: 'all-applets-ready',
};

// Track which applets have been marked as ready
const readyApplets = new Set<string>();

@localized()
@customElement('view-frame')
export class ViewFrame extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  mossStore!: MossStore;

  @property()
  renderView!: RenderView;

  @property()
  iframeKind!: IframeKind;

  @property()
  reloading = false;

  @state()
  appletDevPort: number | undefined;

  @state()
  loading = true;

  @state()
  slowLoading = false;

  @state()
  slowReloadTimeout: number | undefined;

  @state()
  lifecycleState: LifecycleState = 'active';

  @state()
  inactivityTimer: number | undefined;

  @state()
  suspendedTimer: number | undefined;

  // Configuration
  private readonly INACTIVITY_TO_SUSPENDED = 10 * 1000 //5 * 60 * 1000; // 5 minutes
  private readonly SUSPENDED_TO_DISCARDED = 30 * 1000 //30 * 60 * 1000; // 30 minutes

  private _dashboardState = new StoreSubscriber(
    this,
    () => this.mossStore.dashboardState(),
    () => [this.mossStore],
  );

  private _previousDashboardState: typeof this._dashboardState.value | undefined;

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
      if (!readyApplets.has(appletId)) {
        // This is a new applet iframe being created
        console.log(`[PERF DEBUG] Starting to load applet: ${appletId}`);
      }
      // Initialize lifecycle state to 'active' for new iframes
      this.mossStore.setAppletLifecycleState(this.iframeKind.appletHash, 'active');
      this.lifecycleState = 'active';
    }
  }

  willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('reloading')) {
      if (this.reloading) {
        // If it takes longer than 5 seconds to unload, offer to hard reload
        this.slowReloadTimeout = window.setTimeout(() => {
          if (this.reloading) {
            this.slowLoading = true;
          }
        }, 4500);
        this.loading = true;
      } else {
        if (this.slowReloadTimeout) window.clearTimeout(this.slowReloadTimeout);
        this.loading = false;
        this.slowLoading = false;
      }
    }
  }

  updated(changedProperties: PropertyValues<this>) {
    super.updated(changedProperties);

    // Update lifecycle state when dashboard state or renderView changes
    const currentDashboardState = this._dashboardState.value;
    const dashboardStateChanged =
      this._previousDashboardState !== currentDashboardState &&
      JSON.stringify(this._previousDashboardState) !== JSON.stringify(currentDashboardState);

    if (dashboardStateChanged || changedProperties.has('renderView')) {
      this._previousDashboardState = currentDashboardState;
      this.updateLifecycleState();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearInactivityTimer();
    this.clearSuspendedTimer();
  }

  private updateLifecycleState() {
    if (this.renderView.type !== 'applet-view' || this.iframeKind.type !== 'applet') {
      return; // Only manage lifecycle for applet main views
    }

    const appletHash = this.iframeKind.appletHash;
    const dashboardState = this._dashboardState.value;

    // Applet is active if:
    // 1. Dashboard is showing a group view
    // 2. This applet is the selected applet in that group
    const isActive =
      dashboardState.viewType === 'group' &&
      dashboardState.appletHash &&
      encodeHashToBase64(dashboardState.appletHash) === encodeHashToBase64(appletHash);

    if (isActive) {
      // Applet is now active (user selected it, or switched to its group)
      this.setLifecycleState('active');
      this.clearInactivityTimer();
    } else {
      // Applet is now inactive (user selected different applet, or switched groups)
      // Note: Applet remains in lifecycle states even when its group is not active
      // It will become active again when user switches back to it
      if (this.lifecycleState === 'active') {
        this.setLifecycleState('inactive');
        this.startInactivityTimer();
      }
      // If already inactive/suspended/discarded, stay in that state
    }
  }

  private setLifecycleState(state: LifecycleState) {
    const previousState = this.lifecycleState;
    this.lifecycleState = state;

    // Update MossStore with lifecycle state for UI display
    if (this.renderView.type === 'applet-view' && this.iframeKind.type === 'applet') {
      this.mossStore.setAppletLifecycleState(this.iframeKind.appletHash, state);
    }

    // Notify iframe of lifecycle change (if iframe still exists)
    const iframe = this.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(
          {
            type: 'lifecycle-state-change',
            state,
            previousState,
          },
          '*',
        );
      } catch (e) {
        // Iframe may be cross-origin or not accessible
        console.warn('Failed to send lifecycle state change to iframe:', e);
      }
    }

    // Handle state transitions
    if (state === 'suspended' && previousState === 'inactive') {
      this.suspendIframe();
      this.startSuspendedTimer();
    } else if (state === 'discarded' && previousState === 'suspended') {
      this.discardIframe();
    } else if (state === 'active' && previousState === 'suspended') {
      this.restoreIframe();
      this.clearSuspendedTimer();
    } else if (state === 'active' && previousState === 'discarded') {
      this.recreateIframe();
    } else if (state === 'active') {
      this.clearSuspendedTimer();
    }
  }

  private startInactivityTimer() {
    this.clearInactivityTimer();

    this.inactivityTimer = window.setTimeout(() => {
      if (this.lifecycleState === 'inactive') {
        this.setLifecycleState('suspended');
      }
    }, this.INACTIVITY_TO_SUSPENDED);
  }

  private startSuspendedTimer() {
    this.clearSuspendedTimer();

    this.suspendedTimer = window.setTimeout(() => {
      if (this.lifecycleState === 'suspended') {
        // Check memory pressure before discarding
        if (this.checkMemoryPressure()) {
          this.setLifecycleState('discarded');
        } else {
          // Still discard after timeout, but less aggressively
          this.setLifecycleState('discarded');
        }
      }
    }, this.SUSPENDED_TO_DISCARDED);
  }

  private clearInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = undefined;
    }
  }

  private clearSuspendedTimer() {
    if (this.suspendedTimer) {
      clearTimeout(this.suspendedTimer);
      this.suspendedTimer = undefined;
    }
  }

  private checkMemoryPressure(): boolean {
    // Use performance.memory API if available (Chrome)
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      const usedMB = memory.usedJSHeapSize / 1048576;
      const totalMB = memory.totalJSHeapSize / 1048576;
      return usedMB / totalMB > 0.8; // 80% memory usage
    }
    return false;
  }

  private suspendIframe() {
    // Remove iframe from DOM but keep reference for quick restore
    const iframe = this.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe) {
      // Notify the iframe to suspend its internal DOM
      if (iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage(
            {
              type: 'suspend-dom',
            },
            '*',
          );
        } catch (e) {
          console.warn('Failed to send suspend-dom message to iframe:', e);
        }
      }
      // Hide iframe (still in DOM, just not visible)
      iframe.style.display = 'none';
    }
  }

  private discardIframe() {
    // Keep iframe in DOM but hidden - JavaScript context must remain for background processing
    // The iframe's internal DOM can be cleared, but the iframe itself stays alive
    const iframe = this.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe) {
      // Notify iframe to discard its internal DOM (but keep JavaScript context alive)
      if (iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage(
            {
              type: 'discard-dom',
            },
            '*',
          );
        } catch (e) {
          console.warn('Failed to send discard-dom message to iframe:', e);
        }
      }
      // Hide iframe completely but keep it in DOM so JavaScript continues running
      iframe.style.display = 'none';
      iframe.style.visibility = 'hidden';
      iframe.style.position = 'absolute';
      iframe.style.left = '-9999px';
      iframe.style.width = '1px';
      iframe.style.height = '1px';
    }
  }

  private restoreIframe() {
    // Restore iframe to visible (quick restore from suspended)
    const iframe = this.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe) {
      // Restore iframe visibility
      iframe.style.display = 'block';
      iframe.style.visibility = 'visible';
      iframe.style.position = '';
      iframe.style.left = '';
      iframe.style.width = '';
      iframe.style.height = '';
      // Notify iframe to restore its internal DOM
      if (iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage(
            {
              type: 'restore-dom',
            },
            '*',
          );
        } catch (e) {
          console.warn('Failed to send restore-dom message to iframe:', e);
        }
      }
    }
  }

  private recreateIframe() {
    // Restore iframe from discarded state
    // The iframe should still exist (just hidden), so restore it
    const iframe = this.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe) {
      // Iframe still exists, just restore it
      this.restoreIframe();
    } else {
      // Iframe was actually removed somehow, recreate it
      this.requestUpdate();
    }
  }

  hardRefresh() {
    this.slowLoading = false;
    this.dispatchEvent(new CustomEvent('hard-refresh', { bubbles: true, composed: true }));
  }

  renderLoading() {
    return html`
      <div
        class="column center-content"
        style="flex: 1; padding: 0; margin: 0; ${this.loading ? '' : 'display: none'}"
      >
        <img src="loading_animation.svg" />
        <div style="margin-left: 10px; font-size: 18px; color: #142510">
          ${this.reloading ? msg('reloading...') : msg('loading...')}
        </div>
        ${this.slowLoading
        ? html`
              <div class="column items-center" style="margin-top: 50px; max-width: 600px;">
                <div>This Tool takes unusually long to reload. Do you want to force reload?</div>
                <div style="margin-top: 10px; margin-bottom: 20px;">
                  (<b>Warning:</b> Force reloading may interrupt the Tool from saving unsaved
                  content)
                </div>
                <button
                  class="moss-button"
                  @click=${() => this.hardRefresh()}
                  style="margin-top: 20px; width: 150px;"
                >
                  Force Reload
                </button>
              </div>
            `
        : html``}
      </div>
    `;
  }

  handleIframeLoad() {
    this.loading = false;

    // Track when applet iframe is ready (for main applet views)
    if (
      this.renderView.type === 'applet-view' &&
      this.renderView.view.type === 'main' &&
      this.iframeKind.type === 'applet'
    ) {
      const appletId = encodeHashToBase64(this.iframeKind.appletHash);
      if (!readyApplets.has(appletId)) {
        readyApplets.add(appletId);

        // Check if this is the first applet ready
        if (readyApplets.size === 1) {
          performance.mark(PERF_MARKERS.FIRST_APPLET_READY);

          // Check if GROUP_SETUP_START marker exists
          const setupStartMark = performance.getEntriesByName(PERF_MARKERS.GROUP_SETUP_START, 'mark');
          if (setupStartMark.length > 0) {
            try {
              performance.measure(
                'first-applet-ready',
                PERF_MARKERS.GROUP_SETUP_START,
                PERF_MARKERS.FIRST_APPLET_READY,
              );

              const measure = performance.getEntriesByName('first-applet-ready');
              if (measure.length > 0) {
                const lastMeasure = measure[measure.length - 1];
                console.log(`[PERF] First applet ready: ${lastMeasure.duration.toFixed(2)}ms`);
              }
            } catch (e) {
              console.warn('[PERF] Failed to measure first-applet-ready:', e);
              // Fallback: measure from navigation start
              const navStart = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
              if (navStart) {
                const timeSinceNavStart = performance.now() - navStart.fetchStart;
                console.log(`[PERF] First applet ready (from nav start): ${timeSinceNavStart.toFixed(2)}ms`);
              }
            }
          } else {
            // GROUP_SETUP_START marker doesn't exist, use navigation timing as fallback
            const navStart = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
            if (navStart) {
              const timeSinceNavStart = performance.now() - navStart.fetchStart;
              console.log(`[PERF] First applet ready (from nav start, no group-setup-start): ${timeSinceNavStart.toFixed(2)}ms`);
            } else {
              console.log(`[PERF] First applet ready: ${appletId}`);
            }
          }
        }
      }
    }
  }

  renderProductionFrame() {
    // Always render iframe - even when discarded, it stays in DOM (hidden) for background processing
    const isHidden = this.loading ||
      this.lifecycleState === 'suspended' ||
      this.lifecycleState === 'discarded';

    return html`<iframe
        frameborder="0"
        title="TODO"
        id=${this.renderView.type === 'applet-view' &&
        this.renderView.view.type === 'main' &&
        this.iframeKind.type === 'applet'
        ? encodeHashToBase64(this.iframeKind.appletHash)
        : this.renderView.type}
        src="${iframeOrigin(this.iframeKind)}?${renderViewToQueryString(this.renderView)}"
        style="flex: 1; display: ${isHidden ? 'none' : 'block'}; padding: 0; margin: 0;"
        allow="camera *; microphone *; clipboard-write *;"
        @load=${() => {
        this.handleIframeLoad();
      }}
      ></iframe>
      ${this.renderLoading()}`;
  }

  render() {
    switch (this.mossStore.isAppletDev) {
      case false:
        return this.renderProductionFrame();
      case true:
        if (!this.appletDevPort) {
          return this.renderProductionFrame();
        }
        const iframeSrc = `http://localhost:${this.appletDevPort}?${renderViewToQueryString(
          this.renderView,
        )}#${fromUint8Array(encode(this.iframeKind))}`;

        // Always render iframe - even when discarded, it stays in DOM (hidden) for background processing
        const isHidden = this.loading ||
          this.lifecycleState === 'suspended' ||
          this.lifecycleState === 'discarded';

        return html`<iframe
            frameborder="0"
            title="TODO"
            id=${this.renderView.type === 'applet-view' &&
            this.renderView.view.type === 'main' &&
            this.iframeKind.type === 'applet'
            ? encodeHashToBase64(this.iframeKind.appletHash)
            : this.renderView.type}
            src="${iframeSrc}"
            style="flex: 1; display: ${isHidden ? 'none' : 'block'}; padding: 0; margin: 0;"
            allow="camera *; microphone *; clipboard-write *;"
            @load=${() => {
            this.handleIframeLoad();
          }}
          ></iframe>
          ${this.renderLoading()}`;
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `,
    mossStyles,
  ];
}
