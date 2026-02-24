import { html, LitElement, css, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mossStyles } from '../../shared-styles.js';
import { createMockToolUpdates, createMockAppletsData, createMockGroupsData } from './mock-data.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { decodeHashFromBase64 } from '@holochain/client';
import { until } from 'lit/directives/until.js';
import { getLocalizedTimeAgo } from '../../locales/localization.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { markdownParseSafe, refreshAllAppletIframes } from '../../utils.js';
import { MossUpdateInfo } from '../../electron-api.js';
import { LoadingDialog } from '../../elements/dialogs/loading-dialog.js';
import { MossNotification, ToolInfoAndLatestVersion, UpdateFeedMessage } from '../../types.js';
import { commentHeartIconFilled } from '../../icons/icons.js';
import { MossDialog } from '../../elements/_new_design/moss-dialog.js';
import pluralize from 'pluralize';
import quotesData from './SnapTalkFunnies.json';
import { mdiGraph } from '@mdi/js';
import { AppletId } from '@theweave/api';
import { ToolCompatibilityId } from '@theweave/moss-types';

import '../../elements/_new_design/moss-dialog.js';
import { PersistedStore } from '../../persisted-store.js';

import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '../../elements/dialogs/select-group-dialog.js';
import './elements/feed-element.js';
import '../../applets/elements/applet-logo.js';
import '../../applets/elements/applet-logo-raw.js';
import '../../applets/elements/applet-title.js';
import '../../elements/dialogs/loading-dialog.js';
import './elements/notification-card.js'


type UpdateFeedMessageGeneric =
  | {
    type: 'Moss';
    timestamp: number;
    content: {
      type: string;
      timestamp: number;
      message: string;
    };
  }
  | {
    type: 'Tool';
    timestamp: number;
    content: {
      tool: ToolInfoAndLatestVersion;
    };
  };

enum WelcomePageView {
  Main,
}
@localized()
@customElement('welcome-view')
export class WelcomeView extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @state()
  view: WelcomePageView = WelcomePageView.Main;

  @query('#feedback-dialog')
  _feedbackDialog!: MossDialog;

  @query('#changelog-dialog')
  _changelogDialog!: MossDialog;

  @property()
  updateFeed!: Array<UpdateFeedMessage>;

  @state()
  availableMossUpdate: MossUpdateInfo | undefined;

  @state()
  mossUpdatePercentage: number | undefined;

  @state()
  updatingTool = false;

  @state()
  _designFeedbackMode = false;

  @state()
  _experimentalMenuOpen = false;

  _appletClasses = new StoreSubscriber(
    this,
    () => this._mossStore.runningAppletClasses,
    () => [this, this._mossStore],
  );

  private _clickOutsideHandler = (e: MouseEvent) => {
    const path = e.composedPath();
    const dropdown = this.shadowRoot?.querySelector('.experimental-dropdown');
    const button = this.shadowRoot?.querySelector('.experimental-button');
    if (dropdown && button && !path.includes(dropdown) && !path.includes(button)) {
      this._experimentalMenuOpen = false;
    }
  };

  private _persistedStore = new PersistedStore();
  notificationSection: string | null = null;

  isProgrammaticScroll = false;

  availableToolUpdates = new StoreSubscriber(
    this,
    () => this._mossStore.availableToolUpdates(),
    () => [this._mossStore],
  );

  timeAgo = getLocalizedTimeAgo();

  connectedCallback() {
    super.connectedCallback();
    this._designFeedbackMode = this._persistedStore.designFeedbackMode.value();
    window.addEventListener('design-feedback-mode-changed', this._onDesignFeedbackModeChanged as EventListener);
    document.addEventListener('click', this._clickOutsideHandler, true);

    // Initialize collapsed sections based on read state
    this._initializeCollapsedSections();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('design-feedback-mode-changed', this._onDesignFeedbackModeChanged as EventListener);
    document.removeEventListener('click', this._clickOutsideHandler, true);

    // Record current section view on unmount if viewing a section
    if (this.notificationSection) {
      const count = this.getSectionCount(this.notificationSection);
      this._mossStore.recordSectionViewed(this.notificationSection, count);
    }
  }

  private _initializeCollapsedSections() {
    // Get read states and determine which sections should be collapsed
    const readStates = this._persistedStore.sectionReadStates.value();
    const collapsed = new Set<string>();

    Object.keys(readStates).forEach((section) => {
      const currentCount = this.notificationTypes[section] ?? 0;
      if (currentCount <= readStates[section].lastViewedCount) {
        collapsed.add(section);
      }
    });

    this._collapsedSections = collapsed;
  }

  private _onDesignFeedbackModeChanged = (e: CustomEvent<boolean>) => {
    this._designFeedbackMode = e.detail;
  };

  private _enableDesignFeedbackMode() {
    this._designFeedbackMode = true;
    this._persistedStore.designFeedbackMode.set(true);
    window.dispatchEvent(
      new CustomEvent('design-feedback-mode-changed', {
        detail: true,
        bubbles: true,
        composed: true,
      }),
    );
    this._feedbackDialog.hide();
  }
  _notificationFeed = new StoreSubscriber(
    this,
    () => this._mossStore.notificationFeed(),
    () => [this._mossStore],
  );

  _sectionReadStates = new StoreSubscriber(
    this,
    () => this._mossStore.sectionReadStates(),
    () => [this._mossStore],
  );

  @state()
  private _collapsedSections: Set<string> = new Set();

  @state()
  private _showAllItemsSections: Set<string> = new Set();

  // Cache applet subscribers per tool compatibility ID
  _appletsPerToolSubscribers: Map<string, StoreSubscriber<any>> = new Map();

  // Cache group subscribers per tool compatibility ID
  _groupsPerToolSubscribers: Map<string, StoreSubscriber<any>> = new Map();

  // Helper to get tool updates from either mock or real data
  getToolUpdatesSource(): Record<string, ToolInfoAndLatestVersion> {
    return Object.keys(this._mockToolUpdates).length > 0
      ? this._mockToolUpdates
      : this.availableToolUpdates.value;
  }

  @state()
  quotesOfTheDay: Array<{ text: string; source: string }> = [];

  @state()
  currentQuoteIndex = 0;

  // Mock tool updates for development
  @state()
  _mockToolUpdates: Record<string, ToolInfoAndLatestVersion> = {};

  // Mock applets data for development
  _mockAppletsData: Record<string, Map<any, any>> = {};

  // Mock groups data for development
  _mockGroupsData: Record<string, Map<any, any>> = {};

  // DEV MODE: Enable mock tool updates
  _DEV_MODE = false; // Set to true to test UI with mock data

  // Memoization cache for notificationTypes
  private _lastNotifications: Array<any> | null = null;
  private _cachedNotificationTypes: Record<string, number> = {};

  // Reactive getter for notification types derived from _notificationFeed with memoization
  get notificationTypes(): Record<string, number> {
    const notifications = this._notificationFeed.value ?? [];

    // Return cached result if notifications array hasn't changed
    if (notifications === this._lastNotifications) {
      return this._cachedNotificationTypes;
    }

    // Recalculate when notifications change
    const types: Record<string, number> = {};
    notifications.forEach((item) => {
      const notificationType = item.notification.notification_type || "default";
      if (!types[notificationType]) {
        types[notificationType] = 1;
      } else {
        types[notificationType] += 1;
      }
    });

    // Cache the result
    this._lastNotifications = notifications;
    this._cachedNotificationTypes = types;

    return types;
  }

  async firstUpdated() {
    // Load quotes from imported JSON
    this.quotesOfTheDay = quotesData;
    // Choose quote deterministically based on days since epoch
    const daysSinceEpoch = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
    this.currentQuoteIndex = daysSinceEpoch % this.quotesOfTheDay.length;
    console.log('Successfully loaded quotes:', this.quotesOfTheDay.length);

    if (this._DEV_MODE) {
      this._mockToolUpdates = createMockToolUpdates();
      this._mockAppletsData = createMockAppletsData();
      this._mockGroupsData = createMockGroupsData();
      // Mock Moss update for UI testing
      this.availableMossUpdate = {
        version: '0.15.5',
        releaseDate: new Date().toISOString(),
        releaseNotes: `Test update to version 0.15.5

This is a mock update for UI development.

Changes:
- New feature A
- Bug fix B
- Improvement C`,
      };
    } else {
      const availableMossUpdate = await window.electronAPI.mossUpdateAvailable();
      console.log('Available Moss update: ', availableMossUpdate);
      if (availableMossUpdate) {
        this.availableMossUpdate = availableMossUpdate;
        window.electronAPI.onMossUpdateProgress((_, progressInfo) => {
          this.mossUpdatePercentage = progressInfo.percent;
          console.log('Download progress: ', progressInfo);
        });
      }
    }

    // Load notifications once
    await this._mossStore.loadNotificationFeed(30, 300);

    // Add scroll listener for opacity effects
    const scrollContainer = this.shadowRoot?.querySelector('.flex-scrollable-container');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', () => {
        const scrollY = scrollContainer.scrollTop;
        // Start fading only after scrolling halfway up the screen
        const fadeStartPoint = scrollContainer.clientHeight / 3;
        const maxScroll = scrollContainer.clientHeight * 0.4;
        const adjustedScroll = Math.max(0, scrollY - fadeStartPoint);
        const welcomeOpacity = Math.max(1 - (adjustedScroll / maxScroll), 0);
        const quoteOpacity = Math.max(1.4 - (adjustedScroll / maxScroll), 0);

        // Update CSS variables instead of state
        this.style.setProperty('--welcome-opacity', welcomeOpacity.toString());
        this.style.setProperty('--quote-opacity', quoteOpacity.toString());

        // Skip section detection during programmatic scrolling
        if (this.isProgrammaticScroll) return;

        // Determine which section is in the middle of the viewport
        const sections = this.shadowRoot?.querySelectorAll('.scroll-section');
        const viewportMiddle = scrollContainer.clientHeight / 2 + scrollContainer.scrollTop;

        let closestSection: string | null = null;
        let closestDistance = Infinity;

        sections?.forEach((section, index) => {
          const rect = section.getBoundingClientRect();
          const sectionMiddle = scrollContainer.scrollTop + rect.top + rect.height / 2;
          let distance = Math.abs(viewportMiddle - sectionMiddle);

          // Give the first section a bias by reducing its effective distance
          if (index === 0) {
            distance = distance * 0.7; // Make it 30% easier to select
          }

          if (distance < closestDistance) {
            closestDistance = distance;
            closestSection = section.id;
          }
        });

        // Only update if scrolled significantly into a section
        if (closestSection && closestDistance < 300) {
          // Build dynamic section map from actual rendered sections
          const validSections = new Set<string>();

          // Add software-updates if tool updates exist
          if (Object.keys(this.getToolUpdatesSource()).length > 0) {
            validSections.add('software-updates');
          }

          // Add all notification types
          Object.keys(this.notificationTypes).forEach(type => {
            validSections.add(type);
          });

          // Add moss-news if update feed has items
          if (this.updateFeed && this.updateFeed.length > 0) {
            validSections.add('moss-news');
          }

          // Check if the closest section is a valid section
          if (validSections.has(closestSection) && this.notificationSection !== closestSection) {
            this.notificationSection = closestSection;
            this.updateNavigationClasses();
          }
        } else if (scrollY < 200) {
          // Clear selection when near the top
          if (this.notificationSection !== null) {
            this.notificationSection = null;
            this.updateNavigationClasses();
          }
        }
      });
    }

    // DEV: Start on page 2
    // setTimeout(() => {
    //   const sections = this.shadowRoot?.querySelectorAll('.scroll-section');
    //   if (sections && sections.length > 1) {
    //     sections[1].scrollIntoView({ behavior: 'auto' });
    //   }
    // }, 0);
  }

  /**
   * Sync _collapsedSections with actual notification counts.
   * When new notifications arrive, remove sections from _collapsedSections
   * if they should no longer be collapsed (count > lastViewedCount).
   */
  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    // Check if any collapsed sections should be expanded due to new notifications
    const sectionsToExpand: string[] = [];
    this._collapsedSections.forEach((section) => {
      if (!this.isSectionCollapsed(section)) {
        sectionsToExpand.push(section);
      }
    });

    if (sectionsToExpand.length > 0) {
      this._collapsedSections = new Set(
        [...this._collapsedSections].filter((s) => !sectionsToExpand.includes(s))
      );
    }
  }

  showChangelog() {
    this._changelogDialog.show();
  }

  dismissMossUpdate() {
    this.markSectionAsRead('software-updates');
  }

  async installMossUpdate() {
    if (!this.availableMossUpdate) {
      notifyError('No update available.');
      return;
    }
    try {
      this.mossUpdatePercentage = 1;
      await window.electronAPI.installMossUpdate();
    } catch (e) {
      console.error('Moss update failed: ', e);
      notifyError('Update failed (see console for details).');
      this.mossUpdatePercentage = undefined;
    }
  }

  async updateTool(toolInfo: ToolInfoAndLatestVersion) {
    try {
      this.updatingTool = true;
      if (toolInfo.distributionInfo.type !== 'web2-tool-list')
        throw new Error("Cannot update Tool from distribution type other than 'web2-tool-list'");

      const appletIds = await window.electronAPI.batchUpdateAppletUis(
        toolInfo.distributionInfo.info.toolCompatibilityId,
        toolInfo.latestVersion.url,
        toolInfo.distributionInfo,
        toolInfo.latestVersion.hashes.happSha256,
        toolInfo.latestVersion.hashes.uiSha256,
        toolInfo.latestVersion.hashes.webhappSha256,
      );
      console.log('UPDATED UI FOR APPLET IDS: ', appletIds);
      await this._mossStore.checkForUiUpdates();
      (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).hide();
      notify(msg('Tool updated.'));
      // Reload all the associated UIs
      appletIds.forEach((id) => refreshAllAppletIframes(id));
      this.updatingTool = false;
    } catch (e) {
      this.updatingTool = false;
      console.error(`Failed to update Tool: ${e}`);
      notifyError(msg('Failed to update Tool.'));
      (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).hide();
    }
  }

  resetView() {
    this.view = WelcomePageView.Main;
  }

  getRandomQuote() {
    let newIndex;
    do {
      newIndex = Math.floor(Math.random() * this.quotesOfTheDay.length);
    } while (newIndex === this.currentQuoteIndex && this.quotesOfTheDay.length > 1);
    this.currentQuoteIndex = newIndex;
  }

  getTimeOfDayGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 5) return msg('Ah, this wonderful \nP2P world!');
    if (hour < 8) return msg('Good morning, \nyou early-bird!');
    if (hour < 12) return msg('Good morning,\n beautiful human!');
    if (hour < 17) return msg('Welcome back, \nbeautiful human!');
    if (hour < 21) return msg('The best part of the day \nstarts now');
    return msg('Ah, this wonderful \nP2P world!');
  }

  pluralizeAndCapitalize(word: string, count: number): string {
    const pluralized = pluralize(word, count);
    return pluralized.charAt(0).toUpperCase() + pluralized.slice(1);
  }

  /**
   * Get localized label for notification type.
   * Known types (message, mention) are translated; unknown applet-defined types
   * fall back to English pluralization.
   *
   * TODO: Consider using Intl.PluralRules for proper pluralization in each locale,
   * combined with translated word stems, for better internationalization support.
   */
  getLocalizedNotificationTypeLabel(type: string, count: number): string {
    // Map of known notification types to their localized singular/plural forms
    const knownTypes: Record<string, { singular: string; plural: string }> = {
      'message': { singular: msg('Message'), plural: msg('Messages') },
      'mention': { singular: msg('Mention'), plural: msg('Mentions') },
    };

    if (knownTypes[type]) {
      return count === 1 ? knownTypes[type].singular : knownTypes[type].plural;
    }

    // Fall back to English pluralization for unknown/applet-defined types
    const pluralized = pluralize(type, count);
    return pluralized.charAt(0).toUpperCase() + pluralized.slice(1);
  }

  /**
   * Check if a section should be collapsed based on read state.
   * Returns true only if section was marked as read AND no new items have arrived.
   * Also handles ephemeral messages: if count dropped below lastViewedCount,
   * we can't reliably compare, so treat as not collapsed.
   */
  isSectionCollapsed(section: string): boolean {
    const readStates = this._sectionReadStates.value ?? {};
    const readState = readStates[section];
    if (!readState) {
      return false;
    }

    const currentCount = this.getSectionCount(section);

    // If current count is less than lastViewedCount, messages were lost
    // (e.g., ephemeral foyer messages expired). In this case, we can't
    // reliably determine read state, so show as expanded.
    if (currentCount < readState.lastViewedCount) {
      return false;
    }

    // Collapse only if count equals lastViewedCount (no new items)
    return currentCount === readState.lastViewedCount;
  }

  /**
   * Determines if a section should be displayed as collapsed.
   * Prioritizes actual notification count over UI state.
   * This ensures new notifications always cause sections to expand.
   */
  shouldSectionBeCollapsed(section: string): boolean {
    // Always check the actual state first - if new items arrived, never collapse
    const shouldBeCollapsedByState = this.isSectionCollapsed(section);
    if (!shouldBeCollapsedByState) {
      return false;
    }
    // If state says it should be collapsed, also check local UI state for immediate feedback
    return this._collapsedSections.has(section) || shouldBeCollapsedByState;
  }

  /**
   * Expand a collapsed section (just removes from collapsed set)
   */
  expandSection(section: string) {
    this._collapsedSections = new Set(
      [...this._collapsedSections].filter(s => s !== section)
    );
  }

  /**
   * Mark a section as read with current count
   */
  markSectionAsRead(section: string) {
    const count = this.getSectionCount(section);
    this._mossStore.recordSectionViewed(section, count);
    this._collapsedSections = new Set([...this._collapsedSections, section]);
  }

  /**
   * Mark a section as unread (clears read state)
   */
  markSectionAsUnread(section: string) {
    this._mossStore.markSectionAsUnread(section);
    this._collapsedSections = new Set(
      [...this._collapsedSections].filter(s => s !== section)
    );
    // Select this section so the nav list moves to the left
    this.notificationSection = section;
    this.updateNavigationClasses();
  }

  /**
   * Render collapsed section header
   */
  renderCollapsedSectionHeader(section: string, count: number) {
    let label: string;
    if (section === 'software-updates') {
      label = msg('Software updates');
    } else if (section === 'moss-news') {
      label = msg('Moss news');
    } else if (section === 'default') {
      label = msg('General notifications');
    } else {
      label = this.getLocalizedNotificationTypeLabel(section, count);
    }

    return html`
      <div class="collapsed-section-header" @click=${() => this.expandSection(section)}>
        <div class="collapsed-section-info">
          <span class="collapsed-section-label">${label}</span>
          <span class="collapsed-section-count">${count} ${msg('read')}</span>
        </div>
        <button
          class="mark-unread-button"
          @click=${(e: Event) => {
            e.stopPropagation();
            this.markSectionAsUnread(section);
          }}
        >
          ${msg('Mark as unread')}
        </button>
      </div>
    `;
  }

  /**
   * Render section header with label and mark-as-read button
   */
  renderSectionHeader(section: string, label: string) {
    return html`
      <div class="section-header">
        <div class="mini-button">${label}</div>
        <sl-tooltip content="${msg('Mark section as read')}" placement="right">
          <button
            class="mark-read-button"
            @click=${(e: Event) => {
              e.stopPropagation();
              this.markSectionAsRead(section);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 1C4.13401 1 1 4.13401 1 8C1 11.866 4.13401 15 8 15C11.866 15 15 11.866 15 8C15 4.13401 11.866 1 8 1ZM11.7071 6.70711L7.70711 10.7071C7.31658 11.0976 6.68342 11.0976 6.29289 10.7071L4.29289 8.70711C3.90237 8.31658 3.90237 7.68342 4.29289 7.29289C4.68342 6.90237 5.31658 6.90237 5.70711 7.29289L7 8.58579L10.2929 5.29289C10.6834 4.90237 11.3166 4.90237 11.7071 5.29289C12.0976 5.68342 12.0976 6.31658 11.7071 6.70711Z" fill="currentColor"/>
            </svg>
          </button>
        </sl-tooltip>
      </div>
    `;
  }

  /**
   * Get section count for any section type
   */
  getSectionCount(section: string): number {
    if (section === 'software-updates') {
      return Object.keys(this.getToolUpdatesSource()).length + (this.availableMossUpdate ? 1 : 0);
    } else if (section === 'moss-news') {
      return this.updateFeed?.length ?? 0;
    } else {
      return this.notificationTypes[section] ?? 0;
    }
  }

  /**
   * Get the number of UNREAD items in a section.
   * This is the count of new items since the section was last marked as read.
   */
  getUnreadCount(section: string): number {
    const totalCount = this.getSectionCount(section);
    const readStates = this._sectionReadStates.value ?? {};
    const readState = readStates[section];

    if (!readState) {
      // Never marked as read - all items are unread
      return totalCount;
    }

    // If messages were lost (ephemeral), show total as unread
    if (totalCount < readState.lastViewedCount) {
      return totalCount;
    }

    // Return only new items since last view
    return Math.max(0, totalCount - readState.lastViewedCount);
  }

  /**
   * Get the number of previously READ items in a section.
   */
  getReadCount(section: string): number {
    const totalCount = this.getSectionCount(section);
    const unreadCount = this.getUnreadCount(section);
    return Math.max(0, totalCount - unreadCount);
  }

  /**
   * Check if a notification is "read" based on when the section was last viewed.
   * Uses timestamp comparison: if notification arrived before lastViewedAt, it's read.
   */
  isNotificationRead(notification: MossNotification, section: string): boolean {
    const readStates = this._sectionReadStates.value ?? {};
    const readState = readStates[section];

    if (!readState) {
      // Section was never marked as read - all notifications are unread
      return false;
    }

    // A notification is read if it arrived before the section was last viewed
    return notification.notification.timestamp <= readState.lastViewedAt;
  }

  /**
   * Toggle showing all items (including previously read) in a section.
   */
  toggleShowAllItems(section: string) {
    if (this._showAllItemsSections.has(section)) {
      this._showAllItemsSections = new Set(
        [...this._showAllItemsSections].filter(s => s !== section)
      );
    } else {
      this._showAllItemsSections = new Set([...this._showAllItemsSections, section]);
    }
  }

  /**
   * Check if a section is showing all items (including read).
   */
  isShowingAllItems(section: string): boolean {
    return this._showAllItemsSections.has(section);
  }

  /**
   * Render notifications for a section, filtering by read/unread status.
   * Shows unread notifications first, then optionally shows read ones with a toggle.
   */
  renderSectionNotifications(section: string) {
    const allNotifications = this._notificationFeed.value
      ?.filter((item) => (item.notification.notification_type || "default") === section) ?? [];

    if (allNotifications.length === 0) {
      return html`<div>${msg('No notifications yet...')}</div>`;
    }

    const unreadNotifications = allNotifications.filter(n => !this.isNotificationRead(n, section));
    const readNotifications = allNotifications.filter(n => this.isNotificationRead(n, section));
    const readCount = readNotifications.length;
    const showingAll = this.isShowingAllItems(section);

    return html`
      ${unreadNotifications.length > 0
        ? unreadNotifications.map((notification) => this.renderNotification(notification))
        : readCount === 0 ? html`<div>${msg('No notifications yet...')}</div>` : ''
      }
      ${readCount > 0 ? html`
        <button
          class="show-read-button"
          @click=${() => this.toggleShowAllItems(section)}
        >
          ${showingAll ? msg('Hide previously read') : msg('Show previously read')} (${readCount})
        </button>
        <div class="read-notifications-wrapper ${showingAll ? 'expanded' : 'collapsed'}">
          <div class="read-notifications-content">
            ${readNotifications.map((notification) => this.renderNotification(notification))}
          </div>
        </div>
      ` : ''}
    `;
  }

  updateNavigationClasses() {
    const navList = this.shadowRoot?.querySelector('.update-nav-list');
    const allStreamsBtn = this.shadowRoot?.querySelector('.all-streams-button.fixed');
    if (navList) {
      if (this.notificationSection) {
        navList.classList.add('left');
        allStreamsBtn?.classList.add('left');
      } else {
        navList.classList.remove('left');
        allStreamsBtn?.classList.remove('left');
      }
    }

    const headers = this.shadowRoot?.querySelectorAll('.notification-filter-header');
    headers?.forEach((header) => {
      const section = header.getAttribute('data-section');
      if (section === this.notificationSection) {
        header.classList.add('selected');
      } else {
        header.classList.remove('selected');
      }
    });
  }

  selectNotificationSection(section: string) {
    console.log('Selecting notification section: ', section);
    if (this.notificationSection === section) {
      // Scroll to top
      this.isProgrammaticScroll = true;
      setTimeout(() => {
        const scrollContainer = this.shadowRoot?.querySelector('.flex-scrollable-container');
        if (scrollContainer) {
          scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
          // Clear selection and re-enable scroll listener after animation completes
          setTimeout(() => {
            this.notificationSection = null;
            this.updateNavigationClasses();
            this.isProgrammaticScroll = false;
          }, 600);
        }
      }, 100);
    } else {
      // Expand section if it's collapsed so we can scroll to it
      if (this.shouldSectionBeCollapsed(section)) {
        this.expandSection(section);
      }

      this.notificationSection = section;
      this.updateNavigationClasses();
      // Scroll to position the section top at or just above the middle of the screen
      this.isProgrammaticScroll = true;
      // Use slightly longer timeout to allow for DOM update after expanding
      setTimeout(() => {
        const scrollContainer = this.shadowRoot?.querySelector('.flex-scrollable-container');
        const sectionElement = this.shadowRoot?.getElementById(section);
        if (sectionElement && scrollContainer) {
          const sectionRect = sectionElement.getBoundingClientRect();
          const containerRect = scrollContainer.getBoundingClientRect();
          const currentScrollTop = scrollContainer.scrollTop;

          // Calculate the position to place section top at middle of viewport
          const sectionTop = sectionRect.top - containerRect.top + currentScrollTop;
          const targetScrollTop = sectionTop - (containerRect.height * 0.4);

          scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
          // Re-enable scroll listener after animation completes
          setTimeout(() => {
            this.isProgrammaticScroll = false;
          }, 600);
        }
      }, 100);
    }
  }

  private _selectExperimentalView(detail: { type: string; name?: string; toolCompatibilityId?: string }) {
    this._experimentalMenuOpen = false;
    this.dispatchEvent(
      new CustomEvent('personal-view-selected', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  renderToolMenuItems(
    tools: Record<ToolCompatibilityId, { appletIds: AppletId[]; toolName: string }>,
  ) {
    return html`${Object.entries(tools).map(
      ([toolCompatibilityId, info]) => html`
        <button
          class="home-menu-item"
          @click=${() => {
            this._selectExperimentalView({
              type: 'tool',
              toolCompatibilityId,
            });
          }}
        >
          <applet-logo-raw
            .toolIdentifier=${{
              type: 'class' as const,
              toolCompatibilityId,
            }}
            style="--size: 32px; --border-radius: 6px;"
          ></applet-logo-raw>
          <span class="exp-menu-item-label">${info.toolName} cross-group</span>
        </button>
      `,
    )}`;
  }

  renderExperimentalMenu() {
    if (!this._experimentalMenuOpen) return nothing;

    const toolItems =
      this._appletClasses.value.status === 'complete'
        ? this.renderToolMenuItems(this._appletClasses.value.value)
        : nothing;

    return html`
      <div class="experimental-dropdown">
        <button
          class="home-menu-item"
          @click=${() => {
            this._selectExperimentalView({ type: 'moss', name: 'activity-view' });
          }}
        >
          <img src="mountain_stream.svg" style="height: 32px; width: 32px;" />
          <span class="exp-menu-item-label">${msg('All streams')}</span>
        </button>

        <button
          class="home-menu-item"
          @click=${() => {
            this._selectExperimentalView({ type: 'moss', name: 'assets-graph' });
          }}
        >
          <sl-icon
            .src=${wrapPathInSvg(mdiGraph)}
            style="font-size: 32px; color: white;"
          ></sl-icon>
          <span class="exp-menu-item-label">${msg('Artefacts graph')}</span>
        </button>

        ${toolItems}
      </div>
    `;
  }

  renderExperimentalButton() {
    return html`
      <div class="experimental-anchor ${this._experimentalMenuOpen ? 'anchor-open' : ''}">
        <div class="experimental-glow"></div>
        ${this.renderExperimentalMenu()}
        <sl-tooltip .content="${msg('Experimental features')}" placement="top" hoist style="--max-width: 120px;">
          <button
            class="experimental-button"
            @click=${() => {
              this._experimentalMenuOpen = !this._experimentalMenuOpen;
            }}
          >
            ${this._experimentalMenuOpen
              ? html`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6l12 12" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>`
              : html`<img src="clover.svg" style="height: 40px; width: 40px;" />`}
          </button>
        </sl-tooltip>
      </div>
    `;
  }

  renderFeedbackDialog() {
    return html` <moss-dialog
      id="feedback-dialog"
      class="gradient"
      width="900px"
    >
        <div
          class="row" slot="header"
        >
          ${commentHeartIconFilled(28)}
          <span style="margin-left: 5px;">${msg('Feedback')}</span>
        </div>
        <div slot="content">
          ${msg('Moss development is in alpha stage. We highly appreciate active feedback.')}<br /><br />

          <!-- Design Feedback Mode Section -->
          <div class="design-feedback-section">
            <h3 style="margin: 0 0 8px 0;">${msg('Design Feedback Mode')}</h3>
            <p style="margin: 0 0 12px 0; opacity: 0.9;">
              ${msg('Enable Design Feedback Mode to capture screenshots and submit visual feedback directly from anywhere in the app. A feedback button will appear in the top-left corner, allowing you to select any area of the screen and describe your feedback.')}
            </p>
            <p style="margin: 0 0 12px 0; opacity: 0.7; font-size: 14px;">
              ${msg('You can also enable or disable this mode in Settings > Feedback.')}
            </p>
            <sl-button
              variant="primary"
              @click=${() => this._enableDesignFeedbackMode()}
            >
              <div class="row items-center">
                ${commentHeartIconFilled(18)}
                <span style="margin-left: 6px;">${msg('Enable Design Feedback Mode')}</span>
              </div>
            </sl-button>
          </div>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid rgba(255,255,255,0.2);" />

          <h3 style="margin: 0 0 8px 0;">${msg('Other Ways to Give Feedback')}</h3>

          ${msg('If you are encountering a problem and are familiar with Github, you can')}<br /><br />

          <a href="https://github.com/lightningrodlabs/moss/issues/new"
            >${msg('create an issue on Github')}</a
          >
          <br />
          <br />
          ${msg('If you have more general feedback or are not familiar with Github, you can write to the following email address:')}<br /><br />

          <a href="mailto:moss.0.15.feedback@theweave.social">moss.0.15.feedback@theweave.social</a>
        </div>
      </div>
    </moss-dialog>`;
  }

  renderGroupsUsingTool(toolInfo: ToolInfoAndLatestVersion) {
    const toolCompatibilityId = toolInfo.distributionInfo.type === 'web2-tool-list'
      ? toolInfo.distributionInfo.info.toolCompatibilityId
      : undefined;

    if (!toolCompatibilityId) return html``;

    // Get or create subscriber for this tool ID
    if (!this._groupsPerToolSubscribers.has(toolCompatibilityId)) {
      // DEV MODE: Use mock data if available
      if (this._mockGroupsData[toolCompatibilityId]) {
        // Create a mock subscriber with the mock data
        const mockSubscriber: any = {
          value: {
            status: 'complete',
            value: this._mockGroupsData[toolCompatibilityId],
          },
        };
        this._groupsPerToolSubscribers.set(toolCompatibilityId, mockSubscriber);
      } else {
        // TODO: Use real store when available
        // For now, return empty if no mock data
        return html`<span style="color: rgba(0, 0, 0, 0.40);">N/A</span>`;
      }
    }

    const groupsForTool = this._groupsPerToolSubscribers.get(toolCompatibilityId)!;

    if (!groupsForTool.value) {
      return html`<sl-skeleton></sl-skeleton>`;
    }

    switch (groupsForTool.value.status) {
      case 'pending':
        return html`<sl-skeleton></sl-skeleton>`;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching groups')}
          .error=${groupsForTool.value.error}
        ></display-error>`;
      case 'complete':
        const groups = Array.from(groupsForTool.value.value.entries()) as Array<[any, any]>;
        if (groups.length === 0) {
          return html`<span style="color: rgba(0, 0, 0, 0.40);">None</span>`;
        }
        const displayGroups = groups.slice(0, 3);
        const remainingCount = groups.length - 3;
        return html`
          <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
            ${displayGroups.map(([_groupHash, groupData]) => html`
              <sl-tooltip content="${groupData.name}" placement="top">
                <img
                  src="${groupData.icon}"
                  style="width: 32px; height: 32px; border-radius: 8px;"
                />
              </sl-tooltip>
            `)}
            ${remainingCount > 0 ? html`
              <div class="tool-update-more-groups">
                +${remainingCount}
              </div>
            ` : ''}
          </div>
        `;
      default:
        return html``;
    }
  }

  renderToolUpdate(toolInfo: ToolInfoAndLatestVersion) {
    return html`
      <div class="tool-update-outer">
        <div class="install-tool-overlay">
          <sl-button
            ?disabled=${this.updatingTool}
            ?loading=${this.updatingTool}
            @click=${() => this.updateTool(toolInfo)}
            >${msg('Update') + ' ' + toolInfo.toolInfo.title}</sl-button
          >
        </div>
        <div class="tool-update-left-center">
          <div class="tool-update-left">
            <img
              src=${toolInfo.toolInfo.icon}
              style="width: 70px; height: 70px; border-radius: 14px;"
            />
          </div>
          <div class="tool-update-center">
            <div class="tool-update-title">
              ${toolInfo.toolInfo.title}
            </div>
            <div class="tool-update-version">
              ${toolInfo.latestVersion.version}
            </div>
            <div class="tool-update-tags">
              ${toolInfo.toolInfo.tags.slice(0, 2).map((tag) => html`<span class="tool-update-tag">${tag}</span>`)}
            </div>
          </div>
        </div>
        <div class="tool-update-right">
          <span>${msg('Used in:')}</span>
          ${this.renderGroupsUsingTool(toolInfo)}
        </div>
      </div>
    `;
  }

  getFirstLineOfReleaseNotes(): string {
    if (!this.availableMossUpdate?.releaseNotes) {
      return msg('A new release of Moss with exciting features and improvements.');
    }
    // Get first non-empty line
    const lines = this.availableMossUpdate.releaseNotes.split('\n').filter(line => line.trim());
    return lines[0] || msg('A new release of Moss with exciting features and improvements.');
  }

  renderMossUpdateCard() {
    return html`
      <div class="moss-update-available-container">
        <div class="moss-update-header">
          <img src="moss-update.png" class="moss-icon" />
          <div class="moss-update-content">
            <div class="moss-update-title-row">
              <div class="moss-update-title">
                ${msg('New Moss Sprouted!')}
              </div>
              <div class="update-date">
                ${this.availableMossUpdate?.releaseDate
                  ? this.timeAgo.format(new Date(this.availableMossUpdate.releaseDate))
                  : ''}
              </div>
            </div>
            <div class="moss-update-release-notes">
              ${this.getFirstLineOfReleaseNotes()}
            </div>
            <div class="moss-update-buttons">
              ${this.mossUpdatePercentage
                ? html`
                    <div class="column" style="align-items: center;">
                      <div>${msg('Installing...')}</div>
                      <sl-progress-bar
                        value="${this.mossUpdatePercentage}"
                        style="width: 200px; --height: 15px;"
                      ></sl-progress-bar>
                    </div>`
                : html`
                    <div
                      class="install-moss-update-button"
                      @click=${() => this.installMossUpdate()}
                      >${msg('Update now')}</div
                    >
                    <div
                      class="whats-new-button"
                      @click=${() => this.showChangelog()}
                      >${msg("What's new?")}</div
                    >
                  `}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderToolUpdateFeed() {
    const toolUpdatesSource = this.getToolUpdatesSource();

    const toolUpdates: UpdateFeedMessageGeneric[] = Object.values(
      toolUpdatesSource,
    ).map((toolInfo) => ({
      type: 'Tool',
      timestamp: toolInfo.latestVersion.releasedAt,
      content: {
        tool: toolInfo,
      },
    }));

    const sortedToolUpdates = toolUpdates.sort((a, b) => b.timestamp - a.timestamp);

    return html`
      <div class="tool-updates-container column">
        ${sortedToolUpdates.length === 0
        ? html`${msg('No Tool updates available.')}`
        : sortedToolUpdates.map(
          (message) => html`
            ${message.type === 'Tool' ? this.renderToolUpdate(message.content.tool) : html``}
          `,
        )}
      </div>
    `;
  }

  renderQuoteOfTheDay() {
    const currentQuote = this.quotesOfTheDay[this.currentQuoteIndex];
    if (!currentQuote) return html``;

    return html`
      <div class="quote-of-the-day-container" style="opacity: var(--quote-opacity, 1)">
        <div
          class="quote-of-the-day"
        >
          <p>"${currentQuote.text}"</p>
            ${currentQuote.source != '' ? html`<div>(${currentQuote.source})</div>` : ''}
        </div>

        <div class="quote-buttons">
          <!-- <sl-tooltip content="Collect to your pocket." placement="bottom">
            <button variant="white" @click=${() => { }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3.79912 3.0098C3.8801 2.91388 4.00719 2.85742 4.14216 2.85742H11.8604C11.9954 2.85742 12.1226 2.91396 12.2036 3.00999L14.7558 6.0373C14.8833 6.17828 14.8894 6.38044 14.7648 6.52803L8.3443 14.1336C8.26332 14.2295 8.13623 14.286 8.00127 14.286C7.8663 14.286 7.73921 14.2295 7.65823 14.1336L1.22638 6.51456C1.11204 6.37911 1.11204 6.19287 1.22638 6.05742L3.79912 3.0098ZM13.5635 5.89393L12.0147 4.05683L11.3493 5.89598L13.5635 5.89393ZM10.4482 5.89682L11.2722 3.61933H4.73038L5.55599 5.90135L10.4482 5.89682ZM5.83155 6.663L8.00127 12.6601L10.1724 6.65898L5.83155 6.663ZM4.6555 5.90218L3.98767 4.05629L2.42767 5.90425L4.6555 5.90218ZM2.42632 6.66615L6.81108 11.8603L4.93106 6.66383L2.42632 6.66615ZM9.19145 11.8603L13.5849 6.65581L11.0735 6.65814L9.19145 11.8603Z" fill="#151A11"/>
              </svg>
              Collect
            </button>
          </sl-tooltip> -->
          <sl-tooltip content=${msg('More life wisdom.')} placement="bottom">
            <button variant="white" @click=${() => this.getRandomQuote()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.5317 7H15.4642C15.6762 7 15.792 7.24721 15.6563 7.41005L13.69 9.76953C13.5901 9.88947 13.4059 9.88947 13.3059 9.76953L11.3397 7.41005C11.204 7.24721 11.3198 7 11.5317 7Z" fill="black"/>
                <path d="M0.531728 9H4.46421C4.67617 9 4.79196 8.75279 4.65626 8.58995L2.69002 6.23047C2.59007 6.11053 2.40586 6.11053 2.30591 6.23047L0.339672 8.58995C0.203979 8.75279 0.319769 9 0.531728 9Z" fill="black"/>
                <path fill-rule="evenodd" clip-rule="evenodd" d="M7.99797 3C6.44548 3 5.05853 3.70697 4.14065 4.81839C3.96481 5.03131 3.64966 5.06137 3.43674 4.88552C3.22382 4.70968 3.19376 4.39453 3.36961 4.18161C4.46931 2.85003 6.13459 2 7.99797 2C10.9397 2 13.386 4.1165 13.8991 6.90967C13.9046 6.9397 13.9099 6.96981 13.9149 7H12.898C12.435 4.71778 10.4166 3 7.99797 3ZM3.09789 9C3.5609 11.2822 5.57934 13 7.99797 13C9.55046 13 10.9374 12.293 11.8553 11.1816C12.0311 10.9687 12.3463 10.9386 12.5592 11.1145C12.7721 11.2903 12.8022 11.6055 12.6263 11.8184C11.5266 13.15 9.86135 14 7.99797 14C5.05626 14 2.60995 11.8835 2.09688 9.09033C2.09137 9.0603 2.08607 9.03019 2.08101 9H3.09789Z" fill="black"/>
              </svg>
            </button>
          </sl-tooltip>
        </div>
      </div>
    `;
  }

  renderNotifications() {
    const notifications = this._notificationFeed.value ?? [];
    // console.log('Rendering notifications: ', notifications);
    return html`
      <div
        class="notifications-column column"
      >
        ${notifications.length === 0
        ? html`<div>${msg('No notifications yet...')}</div>`
        : notifications.map((notification) => this.renderNotification(notification))}
      </div>
    `;
  }

  renderNotification(notification: MossNotification) {
    if (notification.source.type === 'applet') {
      const appletHash = notification.source.appletHash;
      return html`
        <notification-card
          style="display: flex; flex: 1;"
          .notification=${notification.notification}
          .appletHash=${appletHash}
          @open-applet-main=${(e: CustomEvent) => {
          console.log('notification clicked', e.detail);
          this.dispatchEvent(
            new CustomEvent('open-applet-main', {
              detail: {
                applet: appletHash,
                wal: e.detail.wal,
              },
              bubbles: true,
              composed: true,
            }),
          );
        }}
        @open-wal=${async (e: CustomEvent) => {
          this.dispatchEvent(
            new CustomEvent('open-wal', {
              detail: e.detail,
              bubbles: true,
              composed: true,
            }),
          );
        }}
        ></notification-card>
      `;
    }

    // Render group notifications
    const { notification: frameNotification, sourceName } = notification;
    const groupDnaHashB64 = notification.source.groupDnaHash;
    const aboutWal = frameNotification.aboutWal;
    const groupDnaHash = decodeHashFromBase64(groupDnaHashB64);

    // Get the group profile from the live store (not persisted storage)
    const groupProfilePromise = (async () => {
      const groupStore = await this._mossStore.groupStore(groupDnaHash);
      if (groupStore) {
        return toPromise(groupStore.groupProfile);
      }
      return undefined;
    })();

    const groupIconPromise = groupProfilePromise.then((profile) => {
      if (profile?.icon_src) {
        return html`<img
          class="notification-group-icon"
          src=${profile.icon_src}
          alt=${profile.name || 'Group'}
          title=${profile.name || 'Group'}
        />`;
      }
      return html`<div class="notification-group-icon-placeholder"></div>`;
    });

    const groupNamePromise = groupProfilePromise.then((profile) => profile?.name || 'Group');

    const openGroup = (e: Event) => {
      e.stopPropagation();
      this.dispatchEvent(
        new CustomEvent('open-group', {
          detail: { groupDnaHash },
          bubbles: true,
          composed: true,
        }),
      );
    };

    return html`
      <div class="notification-card" @click=${openGroup}>
        <div class="notification-left">
          ${until(groupIconPromise, html`<div class="notification-group-icon-placeholder"></div>`)}
        </div>
        <div class="notification-center">
          <span>${frameNotification.body}</span>
          ${msg('in')} <b>${sourceName || msg('Unknown Group')}</b>
        </div>
        <div class="notification-right">
          <div class="notification-date">
            ${this.timeAgo.format(new Date(frameNotification.timestamp), 'twitter')}
          </div>
          <div class="notification-buttons">
            ${aboutWal ? html`
              <sl-tooltip content=${msg('Open asset in sidebar')} placement="left">
                <button
                  class="open-wal-button"
                  @click=${(e: Event) => {
          e.stopPropagation();
          this.dispatchEvent(
            new CustomEvent('open-wal', {
              detail: aboutWal,
              bubbles: true,
              composed: true,
            }),
          );
        }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 8C16 8 13 2.5 8 2.5C3 2.5 0 8 0 8C0 8 3 13.5 8 13.5C13 13.5 16 8 16 8ZM1.1727 8C1.22963 7.91321 1.29454 7.81677 1.36727 7.71242C1.70216 7.23193 2.19631 6.5929 2.83211 5.95711C4.12103 4.66818 5.88062 3.5 8 3.5C10.1194 3.5 11.879 4.66818 13.1679 5.95711C13.8037 6.5929 14.2978 7.23193 14.6327 7.71242C14.7055 7.81677 14.7704 7.91321 14.8273 8C14.7704 8.08679 14.7055 8.18323 14.6327 8.28758C14.2978 8.76807 13.8037 9.4071 13.1679 10.0429C11.879 11.3318 10.1194 12.5 8 12.5C5.88062 12.5 4.12103 11.3318 2.83211 10.0429C2.19631 9.4071 1.70216 8.76807 1.36727 8.28758C1.29454 8.18323 1.22963 8.08679 1.1727 8Z" fill="#151A11"/>
                    <path d="M8 5.5C6.61929 5.5 5.5 6.61929 5.5 8C5.5 9.38071 6.61929 10.5 8 10.5C9.38071 10.5 10.5 9.38071 10.5 8C10.5 6.61929 9.38071 5.5 8 5.5ZM4.5 8C4.5 6.067 6.067 4.5 8 4.5C9.933 4.5 11.5 6.067 11.5 8C11.5 9.933 9.933 11.5 8 11.5C6.067 11.5 4.5 9.933 4.5 8Z" fill="#151A11"/>
                  </svg>
                </button>
              </sl-tooltip>
            ` : html``}
            <button class="open-group-button" @click=${openGroup}>
              ${until(groupNamePromise.then((name) => msg(str`Open in ${name} ↗`)), msg('Open in Group ↗'))}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  extractFirstUrl(text: string): string | null {
    const urlRegex = /(https?:\/\/[^\s<>"')\]]+)/g;
    const match = text.match(urlRegex);
    return match ? match[0] : null;
  }

  renderLinkPreview(url: string) {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

    return html`
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="link-preview-card">
        <div class="link-preview-favicon">
          <img src="${favicon}" alt="" @error=${(e: Event) => (e.target as HTMLImageElement).style.display = 'none'} />
        </div>
        <div class="link-preview-content">
          <div class="link-preview-domain">${domain}</div>
          <div class="link-preview-url">${url}</div>
        </div>
      </a>
    `;
  }

  renderMossNewsItem(newsItem: UpdateFeedMessage) {
    const date = new Date(newsItem.timestamp);
    const firstUrl = this.extractFirstUrl(newsItem.message);

    return html`
      <div class="moss-news-card">
        <div class="moss-news-header">
          <span class="moss-news-date">${this.timeAgo.format(date)} · ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        <div class="moss-news-body">
          ${unsafeHTML(markdownParseSafe(newsItem.message))}
        </div>
        ${firstUrl ? this.renderLinkPreview(firstUrl) : ''}
      </div>
    `;
  }

  renderEllipse() {
    return html`
    <svg class="ellipse" width="556" height="160" viewBox="0 0 556 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M278 160C431.535 160 556 88.3656 556 0H0C0 88.3656 124.465 160 278 160Z" fill="url(#paint0_radial_3151_9586)"/>
      <defs>
        <radialGradient id="paint0_radial_3151_9586" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(278 8.96593e-06) rotate(90) scale(149.565 259.87)">
          <stop offset="0.25" stop-color="#E7EEC4"/>
          <stop offset="0.586538" stop-color="#E1EED2" stop-opacity="0.31"/>
          <stop offset="0.807692" stop-color="#E1EED4" stop-opacity="0.0745343"/>
          <stop offset="0.962953" stop-color="#E0EED5" stop-opacity="0"/>
        </radialGradient>
      </defs>
    </svg>
    `;
  }

  render() {
    switch (this.view) {
      case WelcomePageView.Main:
        return html`
          <loading-dialog id="loading-dialog" loadingText=${msg("Updating Tool...")}></loading-dialog>
          <div class="row" style="flex: 1; height: 100%;">
            <div class="update-nav-list">
              ${(Object.keys(this.getToolUpdatesSource()).length > 0 || this.availableMossUpdate) &&
                !this.shouldSectionBeCollapsed('software-updates') ? html`
                <div
                  data-section="software-updates"
                  @click=${() => { this.selectNotificationSection('software-updates'); }}
                  class="notification-filter-header">
                  <span>${msg('Software updates')}</span>
                  <span>${this.getUnreadCount('software-updates')}</span>
                </div>
              `: ''}
              ${Object.keys(this.notificationTypes).map((type) => type != "default" ? html`
                ${!this.shouldSectionBeCollapsed(type) ? html`
                  <div
                    data-section="${type}"
                    @click=${() => { this.selectNotificationSection(type); }}
                    class="notification-filter-header">
                    <span>${this.getLocalizedNotificationTypeLabel(type, this.getUnreadCount(type))}</span>
                    <span>${this.getUnreadCount(type)}</span>
                  </div>
                ` : ''}
              ` : '')}
              ${this.notificationTypes['default'] &&
                !this.shouldSectionBeCollapsed('default') ? html`
                <div
                  data-section="default"
                  @click=${() => { this.selectNotificationSection('default'); }}
                  class="notification-filter-header">
                  <span>${msg('General notifications')}</span>
                  <span>${this.getUnreadCount('default')}</span>
                </div>
              ` : html``}
              ${this.updateFeed && this.updateFeed.length > 0 &&
                !this.shouldSectionBeCollapsed('moss-news') ? html`
                <div
                  data-section="moss-news"
                  @click=${() => { this.selectNotificationSection('moss-news'); }}
                  class="notification-filter-header">
                  <span>${msg('Moss news')}</span>
                  <span>${this.getUnreadCount('moss-news')}</span>
                </div>
              ` : html``}
            </div>
            ${(this._notificationFeed.value?.length ?? 0) > 0 ? html`
              <div
                class="all-streams-button fixed ${this.notificationSection !== null ? 'left' : ''}"
                @click=${() => {
                  this.dispatchEvent(new CustomEvent('personal-view-selected', {
                    detail: { type: 'moss', name: 'activity-view' },
                    bubbles: true,
                    composed: true,
                  }));
                }}
              >
                ${msg('All streams')} ${this._notificationFeed.value?.length ?? 0}
              </div>
            ` : ''}
            <div class="flex-scrollable-container">
              <div class="fixed-section">
                <div class="column" style="align-items: center;">
                  ${this.renderQuoteOfTheDay()}
                  <div class="welcome-message-highlight" style="opacity: calc(var(--welcome-opacity, 1) * 0.5)">
                  </div>
                  <div class="welcome-message" style="opacity: var(--welcome-opacity, 1)">
                    <div style="white-space: pre-line">${this.getTimeOfDayGreeting()}</div>
                  </div>
                </div>
              </div>

              <div class="scrollable-sections-container">
                ${(this._DEV_MODE || this.availableMossUpdate || Object.keys(this.getToolUpdatesSource()).length > 0) ? html`
                  ${this.shouldSectionBeCollapsed('software-updates')
                    ? this.renderCollapsedSectionHeader('software-updates', this.getSectionCount('software-updates'))
                    : html`
                      <div class="scroll-section" id="software-updates">
                        ${this.renderEllipse()}
                        ${this.renderSectionHeader('software-updates', msg('Software updates'))}
                        <div class="software-updates-content">
                          ${this.availableMossUpdate ? this.renderMossUpdateCard() : html``}
                          ${Object.keys(this.getToolUpdatesSource()).length > 0 ? this.renderToolUpdateFeed() : html``}
                        </div>
                      </div>
                    `}
                ` : html``}

                ${this.notificationTypes && Object.keys(this.notificationTypes).length > 0 ? html`

                  ${Object.keys(this.notificationTypes).map((type) => type != "default" ? html`
                    ${this.shouldSectionBeCollapsed(type)
                      ? this.renderCollapsedSectionHeader(type, this.notificationTypes[type])
                      : html`
                        <div class="scroll-section" id="${type}">
                          ${this.renderEllipse()}
                          ${this.renderSectionHeader(type, this.getLocalizedNotificationTypeLabel(type, this.notificationTypes[type]))}

                          <div class="notifications-column column">
                            ${this.renderSectionNotifications(type)}
                          </div>
                        </div>
                      `}
                  ` : '')}

                  ${this.notificationTypes['default'] ? html`
                    ${this.shouldSectionBeCollapsed('default')
                      ? this.renderCollapsedSectionHeader('default', this.notificationTypes['default'])
                      : html`
                        <div class="scroll-section" id="default">
                          ${this.renderEllipse()}
                          ${this.renderSectionHeader('default', msg('General notifications'))}
                          <div class="notifications-column column">
                            ${this.renderSectionNotifications('default')}
                          </div>
                        </div>
                      `}
                  ` : ''}

                ` : html``}

                ${this.updateFeed && this.updateFeed.length > 0 ? html`
                  ${this.shouldSectionBeCollapsed('moss-news')
                    ? this.renderCollapsedSectionHeader('moss-news', this.getSectionCount('moss-news'))
                    : html`
                      <div class="scroll-section" id="moss-news">
                        ${this.renderEllipse()}
                        ${this.renderSectionHeader('moss-news', msg('Moss news'))}
                        <div class="moss-news-column column">
                          ${this.updateFeed.map((newsItem) => this.renderMossNewsItem(newsItem))}
                        </div>
                      </div>
                    `}
                ` : html``}

              </div>
            </div>
          </div>
          ${this.renderExperimentalButton()}
          ${!this._designFeedbackMode ? html`
            <button
              class="feedback-btn"
              @click=${() => this._feedbackDialog.show()}
            >
              <div class="row items-center" style="font-size: 20px; justify-content: center;">
                <span style="margin-bottom: -2px;">${commentHeartIconFilled(20)}</span>
                <span style="margin-left: 5px;">${msg('Feedback')}</span>
              </div>
            </button>
          ` : nothing}
          ${this.renderFeedbackDialog()}
          <moss-dialog
            id="changelog-dialog"
            width="600px"
          >
            <div class="row" slot="header">
              <span>${msg("What's new in")} V${this.availableMossUpdate?.version}</span>
            </div>
            <div slot="content" class="changelog-content">
              ${this.availableMossUpdate?.releaseNotes
                ? unsafeHTML(markdownParseSafe(this.availableMossUpdate.releaseNotes))
                : msg('A new release of Moss with exciting features and improvements.')}
            </div>
          </moss-dialog>
        `;
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
        position: relative;
        /* background-color: #588121; */
        /* background-color: #224b21; */
        /* background-color: var(--moss-dark-green); */
        border-radius: 5px 0 0 0;
        /* opacity: 0.8; */
        background: url('/mosshome.jpg') no-repeat center center fixed;
        background-size: cover;
        height: 100%;
      }

      .update-nav-list {
        top: calc(50% - 110px);
        display: flex;
        flex-direction: column;
        gap: 4px;
        justify-content: center;
        width: fit-content;
        align-items: center;
        z-index: 2;
        pointer-events: none;
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        transition: left 0.16s ease, transform 0.3s ease;
      }

      .update-nav-list.left {
        left: 19px;
        transform: translateX(0);
        align-items: flex-start;
      }

      .notification-filter-header {
        display: inline-flex;
        padding: 16px 20px;
        width: fit-content;
        gap: 20px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.80);
        transition: background 0.3s ease;
        pointer-events: auto;
        cursor: pointer;
      }

      .notification-filter-header:hover, .notification-filter-header.selected {
        background: #fff;
      }

      .collapsed-section-header {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.50);
        cursor: pointer;
        transition: background 0.2s ease;
        width: 510px;
        margin: 4px 0;
        z-index: 2;
        position: relative;
      }

      .collapsed-section-header:hover {
        background: rgba(255, 255, 255, 0.80);
      }

      .collapsed-section-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .collapsed-section-label {
        font-weight: 500;
        color: var(--moss-dark-button);
      }

      .collapsed-section-count {
        font-size: 12px;
        color: rgba(21, 26, 17, 0.6);
      }

      .mark-unread-button {
        padding: 8px 12px;
        border-radius: 8px;
        border: none;
        background: rgba(21, 26, 17, 0.10);
        color: var(--moss-dark-button);
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s ease;
        pointer-events: auto;
        z-index: 3;
      }

      .mark-unread-button:hover {
        background: rgba(21, 26, 17, 0.20);
      }

      .section-header {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        position: relative;
        z-index: 2;
      }

      .section-header .mark-read-button {
        position: absolute;
        right: 16px;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: rgba(21, 26, 17, 0.4);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease, color 0.2s ease, opacity 0.2s ease;
        opacity: 0;
        z-index: 3;
        pointer-events: auto;
      }

      .scroll-section:hover .section-header .mark-read-button {
        opacity: 1;
      }

      .section-header .mark-read-button:hover {
        background: rgba(21, 26, 17, 0.1);
        color: var(--moss-dark-button);
      }

      .show-read-button {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px 20px;
        margin: 8px 0;
        border: 1px dashed rgba(21, 26, 17, 0.3);
        border-radius: 12px;
        background: transparent;
        color: rgba(21, 26, 17, 0.6);
        font-size: 14px;
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
        width: 100%;
        position: relative;
        z-index: 5;
      }

      .show-read-button:hover {
        background: rgba(21, 26, 17, 0.05);
        border-color: rgba(21, 26, 17, 0.5);
        color: rgba(21, 26, 17, 0.8);
      }

      .read-notifications-wrapper {
        display: grid;
        transition: grid-template-rows 0.3s ease-out, opacity 0.3s ease-out;
      }

      .read-notifications-wrapper.collapsed {
        grid-template-rows: 0fr;
        opacity: 0;
      }

      .read-notifications-wrapper.expanded {
        grid-template-rows: 1fr;
        opacity: 1;
      }

      .read-notifications-content {
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .flex-scrollable-container {
        display: flex;
        flex-direction: column;
        overflow-y: scroll;
        /* scroll-snap-type: y mandatory; */
        /* height: 100vh; */
        scrollbar-width: none; /* Firefox */
        -ms-overflow-style: none; /* IE/Edge */
        z-index: 1;
      }

      .flex-scrollable-container::-webkit-scrollbar {
        display: none; /* Chrome, Safari, Opera */
      }

      .fixed-section {
        position: fixed;
        width: calc(100% - 90px);
        height: 300px;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1;
        pointer-events: none;
      }

      .scrollable-sections-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        margin-top: 100vh;
        margin-bottom: 50vh;
        z-index: 1;
      }

      .scroll-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex-shrink: 0;
        transition: all 0.3s ease;
        border-radius: 28px;
        width: 556px;
        background: rgba(255, 255, 255, 0.30);
        backdrop-filter: blur(12px);
      }
      
      .scroll-section .ellipse {
        position: absolute;
        fill: radial-gradient(46.74% 93.48% at 50% 0%, var(--09, #E7EEC4) 25%, rgba(225, 238, 210, 0.31) 58.65%, rgba(225, 238, 212, 0.07) 80.77%, rgba(224, 238, 213, 0.00) 96.3%);
      }

      .scroll-section .mini-button {
        display: flex;
        z-index: 1;
        width: 100%;
        padding: 8px 10px;
        margin: 8px;
        justify-content: center;
        align-items: center;
        gap: 10px;
      }

      .software-updates-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        width: 100%;
      }

      .moss-update-available-container {
        border-radius: 20px;
        padding: 16px;
        width: 540px;
        box-sizing: border-box;
        border: 1px solid #FFF;
        background: linear-gradient(180deg, var(--Moss-main-green, #E0EED5) 18.05%, #F5F5F3 99.92%);
      }

      .moss-update-header {
        display: flex;
        flex-direction: row;
        gap: 16px;
        align-items: stretch;
      }

      .moss-update-content {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        justify-content: space-between;
      }

      .moss-update-title-row {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        width: 100%;
      }

      .moss-update-buttons {
        display: flex;
        width: 100%;
        margin-top: 8px;
        gap: 8px;
      }

      .install-moss-update-button {
        display: flex;
        width: 100%;
        padding: 8px 10px;
        justify-content: center;
        border-radius: 8px;
        background: #151A11;
        color: #FFF;
        font-size: 12px;
        font-style: normal;
        font-weight: 500;
        cursor: pointer;
      }

      .install-moss-update-button:hover {
        background: color-mix(in srgb, #151A11 80%, #FFF 20%);
      }

      .whats-new-button {
        display: flex;
        width: 100%;
        padding: 8px 10px;
        justify-content: center;
        border-radius: 8px;
        background: rgba(50, 77, 71, 0.10);
        color: var(--moss-dark-button, #151A11);
        font-size: 12px;
        font-style: normal;
        font-weight: 500;
        cursor: pointer;
      }

      .whats-new-button:hover {
        background: rgba(50, 77, 71, 0.20);
      }

      .moss-update-title {
        color: #000;
        font-size: 20px;
        font-style: normal;
        font-weight: 500;
        line-height: 24px;
        letter-spacing: -0.4px;
      }

      .moss-update-release-notes {
        color: #000;
        font-size: 14px;
        font-style: normal;
        font-weight: 400;
        line-height: 20px;
        opacity: 0.6;
      }

      .tool-updates-container {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 8px;
      }

      .notifications-column {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 8px;
      }

      .tool-update-outer {
        position: relative;
        display: flex;
        flex-direction: row;
        align-items: top;
        justify-content: space-between;
        gap: 8px;
        padding: 8px;
        width: 524px;
        border-radius: 20px;
        background: #FFF;
      }

      .install-tool-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 20px;
        background: transparent;
        z-index: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        transition: background 0.3s ease;
      }

      .install-tool-overlay > sl-button {
        opacity: 0;
        pointer-events: auto;
        transition: opacity 0.3s ease;
      }

      .install-tool-overlay > sl-button::part(base) {
        background: var(--moss-purple, #7461EB);
        border-color: var(--moss-purple, #7461EB);
        color: #FFF;
      }

      .install-tool-overlay > sl-button::part(base):hover {
        background: color-mix(in srgb, var(--moss-purple, #7461EB) 80%, #FFF 20%);
        border-color: color-mix(in srgb, var(--moss-purple, #7461EB) 80%, #FFF 20%);
        color: #FFF;
      }

      .tool-update-outer:hover .install-tool-overlay {
        background: color-mix(in srgb, var(--moss-purple, #7461EB) 40%, transparent);
        z-index: 1;
      }

      .tool-update-outer:hover .install-tool-overlay > sl-button {
        opacity: 1;
      }

      .tool-update-left-center {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }

      .tool-update-left {
        display: flex;
      }

      .tool-update-center {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .tool-update-title {
        color: #000;
        font-size: 16px;
        font-style: normal;
        font-weight: 600;
        line-height: 24px; /* 150% */
      }

      .tool-update-version {
        color: rgba(0, 0, 0, 0.40);
        font-size: 12px;
        font-style: normal;
        font-weight: 500;
        line-height: 16px; /* 133.333% */
      }

      .tool-update-tags {
        display: flex;
        gap: 4px;
      }

      .tool-update-tags > span {
        display: inline-flex;
        padding: 2px 8px;
        align-items: center;
        gap: 4px;
        border-radius: 3px;
        background: rgba(194, 253, 86, 0.30);
      }

      .tool-update-tags > span:nth-child(1) {
        background: rgba(137, 214, 188, 0.30);
      }

      .tool-update-right {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 150px;
      }

      .tool-update-right > span {
        color: #000;
        font-family: "Inter Variable";
        font-size: 16px;
        font-style: normal;
        font-weight: 600;
        line-height: 24px; /* 150% */
      }
       
      .tool-update-more-groups {
        display: flex;
        width: 32px;
        padding: 8px 0px;
        justify-content: center;
        align-items: center;
        gap: 10px;
        border-radius: 8px;
        background: #F4FED6;
        color: var(--13, #324D47);
        font-size: 12px;
        font-weight: 500;
      }

      .quote-of-the-day-container {
        position: absolute;
        top: 0;
        margin-top: 20px;
        pointer-events: auto;
      }

      .quote-of-the-day {
        display: inline-flex;
        width: 400px;
        padding: 12px 24px;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.70);
        transition: background 0.3s ease;
      }

      .quote-of-the-day > p {
        white-space: pre-line;
      }

      .quote-of-the-day-container:hover > .quote-of-the-day {
        background: #fff;
      }
      
      .quote-buttons {
        margin-top: 4px;
        display: flex;
        gap: 4px;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .quote-buttons > sl-tooltip > button {
        display: inline-flex;
        padding: 4px 6px;
        justify-content: center;
        align-items: center;
        gap: 4px;
        border-radius: 8px;
        background: #FFF;
        border: 0;
        cursor: pointer;
        transition: background 0.3s ease;
        font-weight: 500;
      }

      .quote-buttons > sl-tooltip > button:hover {
        background: var(--moss-purple, #7461EB);
      }

      .quote-of-the-day-container:hover > .quote-buttons {
        opacity: 1;
      }

      .quote-of-the-day > p {
        color: var(--Moss-dark-button, #151A11);
        text-align: center;
        font-family: 'Mossville-v2';
        font-size: 18px;
        font-style: normal;
        font-weight: 400;
        line-height: 91%; /* 16.38px */
        letter-spacing: -0.54px;
        margin: 0;
      }

      .quote-of-the-day > div {
        color: var(--Moss-dark-button, #151A11);
        text-align: center;
        font-family: "Libre Baskerville";
        font-size: 14px;
        font-style: italic;
        font-weight: 400;
        line-height: 16px; /* 114.286% */
      }

      .welcome-message-highlight {
        position: absolute;
        top: calc(25vh - 185px);
        width: 952px;
        height: 348px;
        border-radius: 100%;
        opacity: 0.5;
        background: #FFF;
        filter: blur(100px);
      }

      .welcome-message {
        position: absolute;
        top: calc(25vh - 60px);
        color: var(--Moss-dark-button, #151A11);
        text-align: center;
        font-family: Mossville-v2;
        font-size: 48px;
        font-style: normal;
        font-weight: 400;
        line-height: 91%; /* 43.68px */
        letter-spacing: -1.44px;
        z-index: 1;
      }

      .moss-icon {
        width: 160px;
        height: 160px;
        border-radius: 15px;
        box-shadow: 0 0 2px 2px #0000001f;
      }

      .recent-activity-header {
        color: #fff;
        opacity: 0.5;
        text-align: left;
      }

      .recent-activity-header h1 {
        font-size: 16px;
      }

      .btn {
        all: unset;
        margin: 12px;
        font-size: 16px;
        padding: 10px;
        background: transparent;
        border: 2px solid #607c02;
        color: white;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.25s ease;
      }

      .btn:hover {
        background: #607c02;
      }

      .btn:active {
        background: var(--sl-color-secondary-300);
      }

      li {
        margin-top: 12px;
      }

      .feedback-btn {
        all: unset;
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 100;
        background: rgba(0, 0, 0, 0.6);
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 14px;
        font-weight: 500;
        line-height: 20px;
        color: white;
        cursor: pointer;
        text-align: center;
        transition: background 0.2s;
      }
      .feedback-btn:hover {
        background: rgba(0, 0, 0, 0.8);
      }
      .feedback-btn:disabled {
        opacity: 0.4;
        background: var(--moss-grey-green);
        cursor: default;
      }

      .feedback-btn:focus-visible {
        outline: 2px solid var(--moss-purple);
      }

      .design-feedback-section {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        padding: 16px;
      }

      .changelog-content {
        font-size: 14px;
        line-height: 1.6;
        max-height: 400px;
        overflow-y: auto;
      }

      .changelog-content h1,
      .changelog-content h2,
      .changelog-content h3 {
        margin-top: 16px;
        margin-bottom: 8px;
      }

      .changelog-content h1:first-child,
      .changelog-content h2:first-child,
      .changelog-content h3:first-child {
        margin-top: 0;
      }

      .changelog-content ul,
      .changelog-content ol {
        padding-left: 20px;
        margin: 8px 0;
      }

      .changelog-content li {
        margin: 4px 0;
      }

      .changelog-content p {
        margin: 8px 0;
      }

      .changelog-content code {
        background: rgba(0, 0, 0, 0.1);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
      }

      .button-section {
        align-items: center;
        color: white;
        /* background: #224b21; */
        /* background: #102520; */
        background: #1e3b25;
        margin: 30px;
        padding: 30px;
        box-shadow: 0 0 2px 2px #3a622d;
        border-radius: 15px;
      }

      .update-feed-el {
        width: 700px;
        position: relative;
        padding: 20px;
        padding-top: 45px;
        border-radius: 10px;
        background: var(--moss-dark-green);
        margin: 6px;
        color: #fff;
        box-shadow: 0 0 2px 2px var(--moss-dark-green);
        /* border: 2px solid #102520; */
        transition: all 0.25s ease;
        font-size: 18px;
        line-height: 1.4;
      }

      .update-feed-el a {
        color: #07cd07;
      }

      .bg-highlighted {
        background: var(--moss-fishy-green);
        color: black;
        box-shadow: 0 0 2px 2px var(--moss-dark-green);
      }

      .update-date {
        font-size: 14px;
        opacity: 0.6;
        white-space: nowrap;
      }

      .update-type {
        font-size: 20px;
        position: absolute;
        top: 7px;
        right: 12px;
        font-weight: bold;
      }

      .feed {
        max-height: calc(100vh - 200px);
        overflow-y: auto;
      }

      .feed::-webkit-scrollbar {
        background-color: rgba(57, 67, 51, 1);
      }

      .feed::-webkit-scrollbar-thumb {
        background: rgba(84, 109, 69, 1);
        border-radius: 10px;
      }

      /* Notification card styles (shared structure for applet and group notifications) */
      .notification-card {
        display: flex;
        flex-direction: row;
        width: 540px;
        min-height: 64px;
        border-radius: 20px;
        background: #FFF;
        color: var(--moss-dark-button, #151A11);
        position: relative;
        cursor: pointer;
      }

      .notification-left {
        padding: 6px;
        width: 64px;
        display: flex;
        align-items: center;
      }

      .notification-center {
        flex: 1;
        padding: 12px;
        max-width: 330px;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--moss-dark-button, #151A11);
        font-size: 14px;
        line-height: 20px;
      }

      .notification-right {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        width: 320px;
        border-radius: 20px;
        padding: 24px;
        padding-right: 16px;
        display: flex;
        align-items: center;
        justify-content: right;
        pointer-events: none;
      }

      .notification-right::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.00) 0%, var(--moss-main-green, #E0EED5) 46.63%);
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .notification-card:hover > .notification-right::before {
        opacity: 1;
      }

      .notification-date {
        font-size: 0.9em;
        color: var(--moss-purple);
        position: absolute;
        z-index: 1;
        transition: opacity 0.2s ease;
      }

      .notification-buttons {
        z-index: 1;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
        display: flex;
        gap: 4px;
      }

      .notification-buttons button {
        background: #fff;
        color: var(--moss-dark-button);
        cursor: pointer;
        display: flex;
        padding: 8px 10px;
        justify-content: center;
        align-items: center;
        gap: 10px;
        border-radius: 8px;
        border: none;
        transition: background 0.1s ease, color 0.1s ease;
      }

      .notification-buttons button:hover {
        background: var(--moss-dark-button);
        color: #fff;
      }

      .notification-buttons button:hover svg path {
        fill: #fff;
      }

      .notification-card:hover .notification-buttons {
        opacity: 1;
        pointer-events: auto;
      }

      .notification-card:hover .notification-date {
        opacity: 0;
      }

      /* Group notification specific icon styles */
      .notification-group-icon {
        height: 48px;
        width: 48px;
        margin-bottom: -2px;
        margin-right: 3px;
        border-radius: 8px;
        object-fit: cover;
      }

      .notification-group-icon-placeholder {
        height: 48px;
        width: 48px;
        margin-bottom: -2px;
        margin-right: 3px;
        border-radius: 8px;
        background: var(--moss-main-green, #E0EED5);
      }

      .all-streams-button {
        display: inline-flex;
        padding: 16px 20px;
        gap: 20px;
        border-radius: 16px;
        background: rgba(21, 26, 17, 0.50);
        color: white;
        cursor: pointer;
        font-weight: 500;
        margin-top: 20px;
      }

      .all-streams-button:hover {
        background: rgba(21, 26, 17, 0.70);
      }

      .moss-news-column {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 8px;
      }

      .moss-news-card {
        display: flex;
        flex-direction: column;
        width: 540px;
        border-radius: 20px;
        background: #FFF;
        color: var(--moss-dark-button, #151A11);
        padding: 16px;
        gap: 12px;
        box-sizing: border-box;
      }

      .moss-news-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .moss-news-date {
        color: var(--moss-purple);
        font-size: 14px;
      }

      .moss-news-body {
        font-size: 14px;
        line-height: 1.5;
      }

      .moss-news-body a {
        color: var(--moss-purple);
        text-decoration: underline;
      }

      .moss-news-body a:hover {
        opacity: 0.8;
      }

      .link-preview-card {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 12px;
        background: var(--moss-main-green, #E0EED5);
        text-decoration: none;
        color: var(--moss-dark-button, #151A11);
        transition: background 0.2s ease;
        margin-top: 8px;
      }

      .link-preview-card:hover {
        background: color-mix(in srgb, var(--moss-main-green, #E0EED5) 80%, #000 10%);
      }

      .link-preview-favicon {
        width: 48px;
        height: 48px;
        border-radius: 8px;
        background: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
      }

      .link-preview-favicon img {
        width: 32px;
        height: 32px;
        object-fit: contain;
      }

      .link-preview-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow: hidden;
      }

      .link-preview-domain {
        font-size: 12px;
        font-weight: 500;
        color: var(--moss-dark-button, #151A11);
      }

      .link-preview-url {
        font-size: 11px;
        color: rgba(21, 26, 17, 0.6);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .all-streams-button.fixed {
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        margin-top: 0;
        z-index: 10;
        transition: left 0.16s ease, transform 0.3s ease;
      }

      .all-streams-button.fixed.left {
        left: 19px;
        transform: translateX(0);
      }

      .experimental-anchor {
        position: absolute;
        bottom: 16px;
        right: 16px;
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      }

      .experimental-anchor sl-tooltip::part(body) {
        text-align: center;
      }

      .experimental-button {
        all: unset;
        position: relative;
        width: 72px;
        height: 72px;
        border-radius: 16px;
        background: var(--moss-dark-button, #151A11);
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
      }

      .experimental-button:focus-visible {
        outline: 2px solid var(--moss-purple);
      }

      .experimental-glow {
        position: absolute;
        bottom: -96px;
        right: -96px;
        width: 264px;
        height: 264px;
        border-radius: 264px;
        background: radial-gradient(50% 50% at 50% 50%, #7461EB 0%, rgba(116, 97, 235, 0.00) 100%);
        opacity: 0;
        z-index: 1;
        pointer-events: none;
        transition: opacity 0.2s ease, height 0.2s ease, bottom 0.2s ease;
      }

      .experimental-anchor:hover > .experimental-glow {
        opacity: 0.7;
      }

      .experimental-anchor.anchor-open > .experimental-glow {
        opacity: 0.7;
        height: calc(100% + 192px);
        bottom: -96px;
      }

      .experimental-dropdown {
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 1;
      }

      .home-menu-item {
        all: unset;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 16px;
        padding: 16px 20px;
        border-radius: 16px;
        background: rgba(21, 26, 17, 0.50);
        backdrop-filter: blur(10px);
        color: white;
        cursor: pointer;
        white-space: nowrap;
      }

      .home-menu-item:hover {
        background: rgba(21, 26, 17, 0.70);
      }

      .home-menu-item:focus-visible {
        outline: 2px solid var(--moss-purple);
      }

      .exp-menu-item-label {
        font-family: 'Inter Variable', sans-serif;
        font-weight: 500;
        font-size: 18px;
        color: white;
      }
    `,
    mossStyles,
  ];
}
