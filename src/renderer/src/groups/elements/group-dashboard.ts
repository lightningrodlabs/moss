import { LitElement, html, nothing, PropertyValues } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { notifyError } from '@holochain-open-dev/elements';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { ActionHash, decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { WAL, weaveUrlFromWal } from '@theweave/api';
import { DnaLocation } from '../../processes/hrl/locate-hrl.js';
import { GridStack, GridStackNode, GridStackOptions } from 'gridstack';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiLock, mdiLockOpenOutline, mdiPaletteOutline, mdiArrowExpandVertical } from '@mdi/js';
import { DashboardTile, DashboardTileEntry, GroupDashboard } from '@theweave/group-client';

import '@theweave/elements/dist/elements/wal-embed.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';
import '../../ui/moss-dialog.js';
import './dashboard-tile-dialog.js';

import { GroupStore } from '../group-store.js';
import { groupStoreContext } from '../context.js';
import { openViewsContext } from '../../layout/context.js';
import { AppOpenViews } from '../../layout/types.js';
import { markdownParseSafe } from '../../utils.js';
import { editIcon, closeIcon } from '../../ui/icons.js';
import { dashboardStyles } from './dashboard-styles.js';
import './dashboard-palette.js';
import {
  DEFAULT_LAYOUTS,
  NewTileDraft,
  canFillHeight,
  nextTileColor,
  tileColorStyle,
  tileKindLabel,
} from './dashboard-tile-utils.js';

@localized()
@customElement('group-dashboard')
export class GroupDashboardEl extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  private _groupStore!: GroupStore;

  @consume({ context: openViewsContext, subscribe: true })
  private _openViews!: AppOpenViews;

  /**
   * Render to light DOM so Gridstack's stylesheet and `<wal-embed>` (which
   * relies on global custom-element resolution and host context) work without
   * extra scoping work. This element is itself slotted inside group-home's
   * shadow root, so "light DOM" here still means *inside that shadow tree* —
   * which is why document.head stylesheets can't reach it and the styles
   * (incl. the raw gridstack CSS) are injected as a scoped <style> block via
   * dashboardStyles().
   */
  protected createRenderRoot() {
    return this;
  }

  private _dashboard = new StoreSubscriber(
    this,
    () => this._groupStore.groupDashboard,
    () => [this._groupStore],
  );

  private _accountabilities = new StoreSubscriber(
    this,
    () => this._groupStore.myAccountabilities,
    () => [this._groupStore],
  );

  /**
   * The pre-dashboard group description (markdown). Subscribed so a group that
   * predates the dashboard can render its old description as a transitional
   * tile until a steward saves a real dashboard. See _legacyDescriptionTiles.
   */
  private _groupDescription = new StoreSubscriber(
    this,
    () => this._groupStore.groupDescription,
    () => [this._groupStore],
  );

  @state() private _editing = false;
  /**
   * Read-only public view of the edit state. group-home reads this to decide
   * which toolbar buttons to render in the header row, and listens for the
   * `editing-changed` event for changes.
   */
  get editing(): boolean {
    return this._editing;
  }
  @state() private _draftTiles: DashboardTileEntry[] = [];
  /**
   * Draft seeding the add/edit-tile dialog. `null` keeps the dialog closed;
   * setting a draft opens it. When `_dialogEditingId` is set the dialog is in
   * "edit" mode and confirming replaces that tile instead of appending.
   */
  @state() private _dialogDraft: NewTileDraft | null = null;
  @state() private _dialogEditingId: string | undefined = undefined;
  /** Draft foyer-enabled flag while editing; persisted on save. */
  @state() private _draftFoyerEnabled = true;
  /**
   * When a palette chip is dropped onto the grid, the drop x/y/w/h is stashed
   * here so the ensuing add flow (dialog or picker) places the new tile at the
   * drop point instead of auto-appending at the bottom.
   */
  private _pendingDropLayout: { x: number; y: number; w: number; h: number } | undefined;

  @query('#grid-root') private _gridEl!: HTMLDivElement;
  @query('#grid-root-static') private _staticGridEl!: HTMLDivElement;

  private _grid: GridStack | undefined;
  private _staticGrid: GridStack | undefined;
  /**
   * Observes the read-mode grid's height-constraining ancestor so the
   * fill-height pass re-runs once the dashboard actually has layout. On first
   * load the group home can be initialized while its panel is still
   * display:none / zero-height (every rect measures 0), so the initial fill
   * collapses the tile; this fires when the panel gains real size and corrects
   * it. The observed box is window/layout-driven, not grown by the tile's own
   * min-height, so there is no measure→grow→measure feedback loop.
   */
  private _staticResizeObserver: ResizeObserver | undefined;
  /**
   * Ids of tiles currently registered with the editable grid. Used to diff
   * against _draftTiles after each Lit render so we can call grid.makeWidget
   * for new tiles without destroying/re-initing the whole grid. See
   * _addTile / _removeTile for the listener-stacking issue that motivates
   * this design.
   */
  private _gridSyncedIds = new Set<string>();

  /** Grid geometry — shared between editable and static grids so fill-height
   * row math matches the actual layout. */
  private static readonly GRID_COLUMNS = 12;
  private static readonly CELL_HEIGHT = 60;
  private static readonly GRID_MARGIN = 12;

  /**
   * Stable id for the tile synthesized from a pre-dashboard group's legacy
   * markdown description. Shared between the read-time render and the edit-mode
   * draft seed so both reference the same tile across renders.
   */
  private static readonly LEGACY_DESCRIPTION_TILE_ID = 'legacy-description';

  /** Guards _applyAllFills against re-entrant calls. */
  private _applyingFills = false;
  /** True while the user is actively dragging/resizing a tile, so the resize
   * handler doesn't fight the interaction. */
  private _interacting = false;
  /** rAF handle so rapid resize events coalesce into one settled measurement. */
  private _resizeRaf = 0;

  /** Custom drag auto-scroll state (replaces gridstack's window-relative one). */
  private _dragScrollEl: HTMLElement | undefined;
  private _dragScrollRaf = 0;
  private _dragPointerY = 0;
  /** Scrollable ancestors locked to overflow:hidden during a drag, with their
   * prior inline overflowY to restore on drop. */
  private _lockedScrollEls: Array<[HTMLElement, string]> = [];
  private _onDragPointerMove = (e: PointerEvent) => {
    this._dragPointerY = e.clientY;
  };
  /** Edge zone (px from top/bottom of the scroll container) where auto-scroll
   * engages, and the max scroll step per frame (~human-paced, ~720px/s at
   * 60fps). */
  private static readonly DRAG_SCROLL_ZONE = 56;
  private static readonly DRAG_SCROLL_MAX_STEP = 12;
  /** Window-resize handler that re-fills fill-height tiles. Debounced to a
   * single animation frame so we measure layout AFTER it settles — measuring
   * mid-resize was producing the scrollbar/gap oscillation. */
  private _onWindowResize = () => {
    if (this._interacting) return;
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = 0;
      if (this._activeTiles().some((t) => t.fillHeight)) this._applyAllFills();
    });
  };

  /**
   * Forward a wal-embed's "user clicked Activate" event into the existing
   * `open-tool-info` flow that the sidebar already uses. We decode the
   * base64 hash hints carried by the library element and pull the full
   * Applet entry from the group DNA so the dialog has everything it needs
   * (title, subtitle, distribution_info, raw hash bytes).
   */
  private _onRequestToolActivation = async (
    e: Event,
  ): Promise<void> => {
    const detail = (e as CustomEvent<{ appletHash: string; groupDnaHash: string }>).detail;
    if (!detail) return;
    try {
      const appletHashBytes = decodeHashFromBase64(detail.appletHash);
      const groupDnaHashBytes = decodeHashFromBase64(detail.groupDnaHash);
      const applet = await this._groupStore.groupClient.getApplet(appletHashBytes);
      if (!applet) {
        notifyError(msg('Could not find the Tool to activate.'));
        return;
      }
      this.dispatchEvent(
        new CustomEvent('open-tool-info', {
          detail: {
            kind: 'activate-applet',
            groupDnaHash: groupDnaHashBytes,
            appletHash: appletHashBytes,
            applet,
          },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      console.error('[group-dashboard] failed to handle request-tool-activation:', err);
      notifyError(msg('Could not open the activate dialog.'));
    }
  };

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('request-tool-activation', this._onRequestToolActivation);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('request-tool-activation', this._onRequestToolActivation);
    this._destroyGrid();
    this._destroyStaticGrid();
    window.removeEventListener('resize', this._onWindowResize);
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    this._stopDragAutoScroll();
  }

  updated(changed: PropertyValues) {
    super.updated(changed);
    if (this._editing) {
      if (this._staticGrid) this._destroyStaticGrid();
      if (this._gridEl && !this._grid) {
        this._initGrid();
        this._syncGridChildren();
      } else if (this._grid) {
        // Grid is already alive; just diff DOM children against gridstack's
        // internal tracking, registering any new tiles Lit just rendered.
        this._syncGridChildren();
      }
    } else {
      if (this._grid) this._destroyGrid();
      // why: gridstack's CSS sets `.grid-stack-item { position: absolute }`,
      // so without a gridstack init the read-only items collapse to 0×0 in
      // the corner. Initialize gridstack in `staticGrid` mode for read-only
      // render too — it places + sizes the items but disables all drag/
      // resize, so the user just sees the saved layout.
      if (this._staticGridEl && !this._staticGrid) this._initStaticGrid();
    }
  }

  /**
   * After a Lit render, walk the grid-stack children and tell gridstack
   * about ones it hasn't seen before via makeWidget. Removed items are
   * already gone from DOM (Lit doesn't keep them); we still drop their ids
   * from _gridSyncedIds so the next add doesn't think they're stale.
   */
  private _syncGridChildren() {
    if (!this._grid || !this._gridEl) return;
    const liveIds = new Set<string>();
    const children = Array.from(
      this._gridEl.querySelectorAll<HTMLElement>(':scope > .grid-stack-item'),
    );
    for (const el of children) {
      const id = el.getAttribute('gs-id') ?? '';
      if (!id) continue;
      liveIds.add(id);
      if (!this._gridSyncedIds.has(id)) {
        // why: makeWidget reads gs-x/y/w/h from the element and registers it
        // with the existing grid. This is the single-listener-attach path
        // we use instead of destroy + re-init.
        this._grid.makeWidget(el);
        this._gridSyncedIds.add(id);
        const entry = this._draftTiles.find((t) => t.id === id);
        if (entry) this._applyFillToTile(this._grid, el, entry);
      }
    }
    for (const id of Array.from(this._gridSyncedIds)) {
      if (!liveIds.has(id)) this._gridSyncedIds.delete(id);
    }
  }

  private _amIPrivileged(): boolean {
    const acc = this._accountabilities.value;
    if (acc.status !== 'complete') return false;
    return acc.value.some((a) => a.type === 'Steward' || a.type === 'Progenitor');
  }

  private _getMyPermissionHash(): ActionHash | undefined {
    const acc = this._accountabilities.value;
    if (acc.status !== 'complete') return undefined;
    for (const a of acc.value) {
      if (a.type === 'Steward') return a.content.permission_hash;
    }
    return undefined;
  }

  private _currentDashboard(): GroupDashboard | undefined {
    const v = this._dashboard.value;
    return v.status === 'complete' ? v.value : undefined;
  }

  /**
   * Public: enter edit mode. Called from group-home's header edit button.
   * Idempotent.
   *
   * why: destroy the static (read-mode) grid BEFORE flipping _editing.
   * Doing it in updated() runs after Lit has already removed the static
   * grid's host element from the DOM, and gridstack v11's destroy() can
   * hang trying to clean up listeners on a detached element — that lock
   * is what causes the "click edit, whole UI freezes" symptom.
   */
  enterEdit() {
    if (this._editing) return;
    this._destroyStaticGrid();
    const current = this._currentDashboard();
    const savedTiles = current && Array.isArray(current.tiles) ? current.tiles : [];
    // Seed the draft from the saved dashboard, or — for a group that has no
    // dashboard yet but had a legacy description — from the synthesized legacy
    // tile so the steward starts editing the description they already see.
    // This materializes only into the draft; it is persisted on save (and left
    // virtual on cancel), so viewing never writes to the DHT.
    this._draftTiles =
      savedTiles.length > 0 ? structuredClone(savedTiles) : this._legacyDescriptionTiles();
    this._draftFoyerEnabled = current ? current.foyerEnabled !== false : true;
    this._editing = true;
    this._emitEditingChanged();
  }

  /**
   * The palette toggled the foyer. Reflect it in the draft (persisted on save);
   * the palette's `foyer-toggled` event keeps bubbling past us to group-home,
   * which mirrors the foyer live.
   */
  private _onFoyerToggled(e: CustomEvent<{ enabled: boolean }>) {
    this._draftFoyerEnabled = e.detail.enabled;
  }

  /** Public: exit edit mode without saving. */
  cancelEdit() {
    if (!this._editing) return;
    // Same reasoning as enterEdit — tear the editable grid down before Lit
    // re-renders the read-only view.
    this._destroyGrid();
    this._editing = false;
    this._emitEditingChanged();
  }

  /**
   * Public: persist the current draft. Returns once save completes (resolves
   * whether successful or not — errors are surfaced via notifyError).
   */
  async save() {
    await this._saveDashboard();
  }

  /**
   * Public: open the add-tile dialog for the given kind. WAL tiles route
   * through the standard asset picker; everything else opens the form dialog.
   */
  requestAddTile(kind: DashboardTile['kind']) {
    if (!this._editing) return;
    if (kind === 'wal-embed') {
      void this._pickWalForTile();
      return;
    }
    this._dialogEditingId = undefined;
    this._dialogDraft =
      kind === 'markdown'
        ? { kind: 'markdown', source: '' }
        : kind === 'image'
          ? { kind: 'image', src: '', alt: '' }
          : { kind: 'iframe', src: '' };
  }

  private _emitEditingChanged() {
    this.dispatchEvent(
      new CustomEvent('editing-changed', {
        detail: { editing: this._editing },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _initGrid() {
    const opts: GridStackOptions = {
      column: GroupDashboardEl.GRID_COLUMNS,
      cellHeight: GroupDashboardEl.CELL_HEIGHT,
      margin: GroupDashboardEl.GRID_MARGIN,
      // why: float=true lets items stay where the user drops them instead of
      // auto-compacting upward. Without this, dragging a tile up has nowhere
      // to land between two stacked tiles and gridstack snaps it back; only
      // downward drags into empty space work.
      float: true,
      animate: true,
      // why: gridstack's built-in drag auto-scroll is window-relative and
      // unbounded — it scrolls by the raw drag delta and only scrolls UP when
      // the element passes the window top (never, since our scroller is the
      // panel). Disable it and run our own bounded, bidirectional edge scroll
      // bound to the real scroll container (see _startDragAutoScroll).
      draggable: { scroll: false, handle: '.tile-drag-handle' },
      // why: autoHide defaults true on desktop — handles are invisible until
      // you mouse over the corner. We want them always visible so users can
      // see they're there. Skip north handles (gridstack warns against `ne`/
      // `nw` resize because of layout side-effects); SE + SW + S + E cover
      // the useful directions.
      resizable: { autoHide: false, handles: 'se, sw, s, e' },
      // accept palette chips dragged in from the edit-mode palette. why a
      // selector (not `true`): `true` only accepts `.grid-stack-item`
      // elements; our chips are `.dash-palette-item`, so the grid would reject
      // the drop and never fire 'dropped'.
      acceptWidgets: '.dash-palette-item',
    };
    this._grid = GridStack.init(opts, this._gridEl);
    // The palette chips register themselves as drag-in sources (see
    // dashboard-palette); this grid accepts them via acceptWidgets above.
    // When a chip is dropped, gridstack inserts a raw node at the drop point.
    // Capture its position + kind, remove that raw node, and route through the
    // normal add flow (dialog / picker) so the tile lands where it was dropped.
    this._grid.on('dropped', (_e: Event, _prev: GridStackNode, node: GridStackNode) => {
      const el = node?.el as HTMLElement | undefined;
      const kind =
        (el?.getAttribute('data-kind') as DashboardTile['kind'] | null) ??
        ((node?.el?.querySelector?.('[data-kind]') as HTMLElement | null)?.getAttribute(
          'data-kind',
        ) as DashboardTile['kind'] | null);
      const layout = {
        x: node.x ?? 0,
        y: node.y ?? 0,
        w: node.w ?? 0,
        h: node.h ?? 0,
      };
      if (el && this._grid) this._grid.removeWidget(el, true);
      if (!kind) return;
      this._pendingDropLayout = layout;
      this.requestAddTile(kind);
    });
    // why: GridStack.init auto-discovers and registers any `.grid-stack-item`
    // children already in the container. Seed our sync set from those so the
    // follow-up _syncGridChildren() doesn't re-register the same items via
    // makeWidget() — double-registration can put gridstack into a layout
    // loop that locks the UI.
    this._gridSyncedIds.clear();
    for (const el of this._grid.getGridItems()) {
      const id = el.getAttribute('gs-id') ?? '';
      if (id) this._gridSyncedIds.add(id);
    }
    this._observeContainerResize();
    this._applyAllFills();
    // why: pause the fill ResizeObserver while the user is actively
    // dragging/resizing, so re-applying fill doesn't fight the interaction
    // (the "drag never stops" bug).
    this._grid.on('dragstart', () => {
      this._interacting = true;
      this._startDragAutoScroll();
    });
    this._grid.on('resizestart', (_e: Event, el: GridStackNode | HTMLElement) => {
      this._interacting = true;
      // Manually resizing a tile means the user wants an explicit size — drop
      // its fill flag and clear the min-height override so gridstack's resize
      // takes effect instead of being pinned to the fill height.
      const node = el as HTMLElement;
      node?.style?.removeProperty?.('min-height');
      const id = node?.getAttribute?.('gs-id') ?? '';
      if (id) {
        this._draftTiles = this._draftTiles.map((t) =>
          t.id === id ? { ...t, fillHeight: false } : t,
        );
      }
    });
    this._grid.on('dragstop', () => {
      this._interacting = false;
      this._stopDragAutoScroll();
    });
    this._grid.on('resizestop', () => (this._interacting = false));
    this._grid.on('change', () => {
      if (!this._grid) return;
      const nodes = this._grid.save(false) as GridStackNode[];
      const byId = new Map(this._draftTiles.map((t) => [t.id, t]));
      const updated = nodes
        .map((n) => {
          const id = String(n.id ?? '');
          const existing = byId.get(id);
          if (!existing) return undefined;
          return {
            ...existing,
            layout: {
              x: n.x ?? existing.layout.x,
              y: n.y ?? existing.layout.y,
              w: n.w ?? existing.layout.w,
              h: n.h ?? existing.layout.h,
            },
          } as DashboardTileEntry;
        })
        .filter((t): t is DashboardTileEntry => !!t);
      if (updated.length === this._draftTiles.length) {
        this._draftTiles = updated;
      }
    });
  }

  private _destroyGrid() {
    if (this._grid) {
      this._grid.destroy(false);
      this._grid = undefined;
    }
  }

  private _initStaticGrid() {
    this._staticGrid = GridStack.init(
      {
        column: GroupDashboardEl.GRID_COLUMNS,
        cellHeight: GroupDashboardEl.CELL_HEIGHT,
        margin: GroupDashboardEl.GRID_MARGIN,
        float: true,
        animate: false,
        staticGrid: true,
      },
      this._staticGridEl,
    );
    this._observeContainerResize();
    this._observeStaticFillBox();
    this._applyAllFills();
  }

  /**
   * Re-run the read-mode fill whenever the grid's height-constraining ancestor
   * changes size — most importantly the 0 → real-height transition when the
   * group home becomes visible after first mount. Debounced through the shared
   * resize rAF so a burst of layout changes coalesces into one settled measure.
   */
  private _observeStaticFillBox() {
    this._staticResizeObserver?.disconnect();
    this._staticResizeObserver = undefined;
    const box = this._fillContainerBox(this._staticGridEl);
    if (!box) return;
    this._staticResizeObserver = new ResizeObserver(() => {
      if (this._editing || !this._staticGrid) return;
      if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = 0;
        if (!this._editing && this._staticGrid) this._applyAllFills();
      });
    });
    this._staticResizeObserver.observe(box);
  }

  /** The grid instance for whichever mode is active. */
  private _activeGrid(): GridStack | undefined {
    return this._editing ? this._grid : this._staticGrid;
  }

  /** The tiles backing whichever mode is active. */
  private _activeTiles(): DashboardTileEntry[] {
    if (this._editing) return this._draftTiles;
    return this._readTiles();
  }

  /**
   * Tiles to show in read mode: the saved dashboard's tiles, or — for a group
   * that has none yet but carried a pre-dashboard markdown description — the
   * synthesized legacy tile.
   */
  private _readTiles(): DashboardTileEntry[] {
    const v = this._dashboard.value;
    const saved = v.status === 'complete' && v.value ? (v.value.tiles ?? []) : [];
    if (saved.length > 0) return saved;
    return this._legacyDescriptionTiles();
  }

  /**
   * The group's legacy markdown description if one was set before the dashboard
   * feature existed. Whitespace-only content counts as absent.
   */
  private _legacyDescription(): string | undefined {
    const v = this._groupDescription.value;
    const text = v.status === 'complete' ? v.value?.data : undefined;
    return text && text.trim().length > 0 ? text : undefined;
  }

  /**
   * Transitional tile list for a group that predates the dashboard: a single
   * full-width, vertical-stretch markdown tile carrying the old description,
   * with no accent background. Returns [] when there is no legacy description.
   *
   * This is a pure read/seed-time fallback — it is computed from the shared
   * description entry so every member renders it identically, and nothing is
   * committed to the DHT on mere viewing. It only becomes a real tile when a
   * steward enters edit (which seeds it into the draft) and saves.
   */
  private _legacyDescriptionTiles(): DashboardTileEntry[] {
    const description = this._legacyDescription();
    if (!description) return [];
    return [
      {
        id: GroupDashboardEl.LEGACY_DESCRIPTION_TILE_ID,
        layout: { x: 0, y: 0, w: GroupDashboardEl.GRID_COLUMNS, h: DEFAULT_LAYOUTS.markdown.h },
        tile: { kind: 'markdown', source: description },
        fillHeight: true,
      },
    ];
  }

  /**
   * Apply fillHeight to a single tile: grow it to (nearly) the bottom of the
   * visible dashboard area. Skips if the tile is no longer bottom-most.
   *
   * why measure-and-correct: row-quantized math alone can't avoid the
   * scrollbar/gap oscillation during resize — the tile height changes in whole
   * 60px steps while the window height is continuous, and gridstack adds its
   * own (hard-to-predict) container margin overhead. So we set an estimated
   * row count, then read the ACTUAL rendered bottom and step the height down a
   * row at a time until the tile fits under the window bottom. This is robust
   * to unknown margins and guarantees no overflow → no flickering scrollbar.
   */
  private _applyFillToTile(grid: GridStack, el: HTMLElement, entry: DashboardTileEntry) {
    const shouldFill = entry.fillHeight && canFillHeight(entry, this._activeTiles());
    if (!shouldFill) {
      // Not (or no longer) filling: drop any min-height override so gridstack's
      // own row-based height governs the tile again. Safe for non-fill tiles
      // too (no-op if unset); does NOT touch gridstack's inline `height`.
      el.style.removeProperty('min-height');
      return;
    }

    const cellPx = grid.getCellHeight(true) || GroupDashboardEl.CELL_HEIGHT;
    const bottomLimit = this._fillBottomLimit(el);
    // why: `top` is the FILL TILE's own top, so the rows that fit below it are
    // (bottomLimit - top) / cellPx — that IS the height in rows. (A previous
    // bug also subtracted entry.layout.y, double-counting the offset and
    // leaving a ~150px gap.)
    const top = el.getBoundingClientRect().top;
    let h = Math.max(1, Math.floor((bottomLimit - top) / cellPx));
    grid.update(el, { h });

    // Back off a row at a time if the rendered tile overshoots the window
    // bottom (covers gridstack's container-margin overhead the math can't
    // see). Bounded iterations.
    let guard = 0;
    while (guard++ < 6 && h > 1 && el.getBoundingClientRect().bottom > bottomLimit) {
      h -= 1;
      grid.update(el, { h });
    }

    // Row sizing leaves up to a sub-cell (~<60px) remainder gap. Close it with
    // a pixel-precise min-height so the tile lands flush at the window bottom.
    // min-height (not height) is used so it coexists with gridstack's inline
    // height and can be cleared without disturbing gridstack's layout.
    const curTop = el.getBoundingClientRect().top;
    const px = Math.max(cellPx, bottomLimit - curTop);
    el.style.setProperty('min-height', `${px}px`);
  }

  /**
   * The viewport y-coordinate that a fill-height tile should reach: the bottom
   * edge of the nearest scrolling ancestor of the grid (the element whose
   * scrollbar would otherwise appear), minus a small inset. Falls back to the
   * window bottom if no scroll ancestor is found.
   *
   * why: measuring against window.innerHeight overshoots — the grid lives in a
   * panel (group header above, foyer beside) that is shorter than the window,
   * so filling to the window bottom overflowed that panel and produced the
   * scrollbar. The real target is the scroll container's bottom.
   */
  private _fillBottomLimit(fromEl: HTMLElement): number {
    let node: HTMLElement | null = fromEl.parentElement;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        // why: the scroll container commonly has `max-height: 100%` and no
        // explicit height (the @holochain-open-dev flex-scrollable pattern),
        // so it COLLAPSES to its content height — measuring its own bottom
        // gives the content height, not the available space. Its containing
        // block (parent) is the full-height box that the `max-height: 100%`
        // resolves against, so use the parent's bottom as the real fill
        // target. Clamp to the window bottom as a safety net.
        const box =
          node.offsetParent instanceof HTMLElement ? node.offsetParent : node.parentElement;
        const bottom = (box ?? node).getBoundingClientRect().bottom;
        return Math.min(bottom, window.innerHeight) - 4;
      }
      node = node.parentElement;
    }
    return window.innerHeight - 4;
  }

  /**
   * The height-constraining box that {@link _fillBottomLimit} measures against:
   * the containing block of the nearest scrolling ancestor (the full-height box
   * the scroller's `max-height: 100%` resolves against). Used as the
   * ResizeObserver target so the fill re-runs when this box gains/changes size.
   * Resolved via computed `overflowY` so it works even while the subtree is
   * still display:none (offsetParent is null then, so fall back to parent).
   */
  private _fillContainerBox(fromEl: HTMLElement): HTMLElement | undefined {
    let node: HTMLElement | null = fromEl.parentElement;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        const box =
          node.offsetParent instanceof HTMLElement ? node.offsetParent : node.parentElement;
        return box ?? node;
      }
      node = node.parentElement;
    }
    return undefined;
  }

  /** The nearest scrolling ancestor of the grid (the element that scrolls). */
  private _scrollContainerOf(fromEl: HTMLElement): HTMLElement | undefined {
    let node: HTMLElement | null = fromEl.parentElement;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === 'auto' || oy === 'scroll') return node;
      node = node.parentElement;
    }
    return undefined;
  }

  /**
   * Begin a bounded, bidirectional edge auto-scroll for the duration of a tile
   * drag. Replaces gridstack's window-relative, unbounded scroll. While the
   * pointer sits within DRAG_SCROLL_ZONE px of the scroll container's top or
   * bottom edge, scroll toward that edge by a capped step per animation frame
   * (speed ramps with how deep into the zone the pointer is).
   */
  private _startDragAutoScroll() {
    const gridEl = this._editing ? this._gridEl : this._staticGridEl;
    if (!gridEl) return;
    this._dragScrollEl = this._scrollContainerOf(gridEl);
    if (!this._dragScrollEl) return;
    // why: during a drag the grid content transiently grows, which makes
    // OUTER scroll-ancestors (e.g. #group-view-area in main-dashboard's shadow
    // DOM) overflow and flash their own scrollbar — the "rogue scrollbar right
    // of the foyer". Only the dashboard's own scroller should scroll during a
    // drag, so lock overflow:hidden on every scrollable ancestor ABOVE it for
    // the drag, restoring on drop. Robust regardless of why each one overflows.
    this._lockAncestorScroll(this._dragScrollEl);
    window.addEventListener('pointermove', this._onDragPointerMove, true);
    const tick = () => {
      const el = this._dragScrollEl;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const zone = GroupDashboardEl.DRAG_SCROLL_ZONE;
      const maxStep = GroupDashboardEl.DRAG_SCROLL_MAX_STEP;
      const y = this._dragPointerY;
      let step = 0;
      if (y < rect.top + zone) {
        // ramp 0..1 as pointer goes from zone edge to the container edge
        const depth = Math.min(1, (rect.top + zone - y) / zone);
        step = -Math.ceil(maxStep * depth);
      } else if (y > rect.bottom - zone) {
        const depth = Math.min(1, (y - (rect.bottom - zone)) / zone);
        step = Math.ceil(maxStep * depth);
      }
      if (step !== 0) el.scrollBy(0, step);
      this._dragScrollRaf = requestAnimationFrame(tick);
    };
    this._dragScrollRaf = requestAnimationFrame(tick);
  }

  private _stopDragAutoScroll() {
    if (this._dragScrollRaf) cancelAnimationFrame(this._dragScrollRaf);
    this._dragScrollRaf = 0;
    window.removeEventListener('pointermove', this._onDragPointerMove, true);
    this._dragScrollEl = undefined;
    this._unlockAncestorScroll();
  }

  /**
   * Lock overflow:hidden on every scrollable ancestor above `fromEl`
   * (crossing shadow boundaries), saving prior inline values to restore later.
   * `fromEl` itself (the dashboard's intended scroller) is left untouched.
   */
  private _lockAncestorScroll(fromEl: HTMLElement) {
    this._lockedScrollEls = [];
    let node: HTMLElement | null = this._parentAcrossShadow(fromEl);
    while (node) {
      const cs = getComputedStyle(node);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflow)) {
        this._lockedScrollEls.push([node, node.style.overflowY]);
        node.style.overflowY = 'hidden';
      }
      node = this._parentAcrossShadow(node);
    }
  }

  private _unlockAncestorScroll() {
    for (const [el, prev] of this._lockedScrollEls) el.style.overflowY = prev;
    this._lockedScrollEls = [];
  }

  /** parentElement, stepping out of a shadow root to its host when needed. */
  private _parentAcrossShadow(el: Element): HTMLElement | null {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
  }

  /** TEMP diagnostic snapshot of which elements have vertical overflow. */
  /** Re-apply fills to all tiles in the active grid. Re-entrancy guarded so
   * the grid.update() calls (which can trigger layout/observer churn) don't
   * recurse. */
  private _applyAllFills() {
    if (this._applyingFills) return;
    const grid = this._activeGrid();
    const gridEl = this._editing ? this._gridEl : this._staticGridEl;
    if (!grid || !gridEl) return;
    this._applyingFills = true;
    try {
      const byId = new Map(this._activeTiles().map((t) => [t.id, t]));
      for (const el of grid.getGridItems()) {
        const id = el.getAttribute('gs-id') ?? '';
        const entry = byId.get(id);
        if (entry) this._applyFillToTile(grid, el, entry);
      }
    } finally {
      this._applyingFills = false;
    }
  }

  /**
   * Re-fill fill-height tiles on window resize. why: a window 'resize'
   * listener (not a ResizeObserver on a content-sized element) avoids the
   * feedback loop where applying fill grows the observed element and re-fires
   * the observer. _visibleRows is measured against window.innerHeight, so
   * window resize is the only event that actually changes the target height.
   */
  private _observeContainerResize() {
    window.removeEventListener('resize', this._onWindowResize);
    window.addEventListener('resize', this._onWindowResize);
  }

  private _destroyStaticGrid() {
    this._staticResizeObserver?.disconnect();
    this._staticResizeObserver = undefined;
    if (this._staticGrid) {
      this._staticGrid.destroy(false);
      this._staticGrid = undefined;
    }
  }

  /**
   * Read current widget positions out of Gridstack and rebuild `_draftTiles`
   * so the next save reflects any drag/resize that happened.
   */
  private _syncDraftFromGrid(): DashboardTileEntry[] {
    if (!this._grid) return this._draftTiles;
    const nodes: GridStackNode[] = this._grid.save(false) as GridStackNode[];
    const byId = new Map(this._draftTiles.map((t) => [t.id, t]));
    return nodes
      .map((n) => {
        const id = String(n.id ?? '');
        const existing = byId.get(id);
        if (!existing) return undefined;
        return {
          ...existing,
          layout: {
            x: n.x ?? existing.layout.x,
            y: n.y ?? existing.layout.y,
            w: n.w ?? existing.layout.w,
            h: n.h ?? existing.layout.h,
          },
        } as DashboardTileEntry;
      })
      .filter((t): t is DashboardTileEntry => !!t);
  }

  private async _saveDashboard() {
    if (!this._amIPrivileged()) {
      notifyError(msg('No permission to edit group home.'));
      this._editing = false;
      this._emitEditingChanged();
      return;
    }
    try {
      const tiles = this._syncDraftFromGrid();
      const dashboard: GroupDashboard = {
        tiles,
        updatedAt: Date.now(),
        foyerEnabled: this._draftFoyerEnabled,
      };
      await this._groupStore.groupClient.setGroupDashboard(this._getMyPermissionHash(), dashboard);
      await this._groupStore.groupDashboard.reload();
      this._destroyGrid();
      this._editing = false;
      this._emitEditingChanged();
    } catch (e) {
      console.error('Failed to save dashboard:', e);
      notifyError(msg('Failed to save group home.'));
    }
  }

  /**
   * Add a new tile. why: we do NOT destroy/re-init the grid. Instead we
   * append to _draftTiles, let Lit render the new DOM element, and then in
   * updated() register that element with gridstack via grid.makeWidget.
   * Destroying the grid on every add was stacking event listeners and
   * causing one drag to move multiple tiles.
   *
   * MAX_SAFE_INTEGER as a "bottom" sentinel hangs GridStack.init laying out
   * that many rows, so we compute the actual next-row y from current tiles.
   */
  private _addTile(tile: DashboardTile) {
    const def = DEFAULT_LAYOUTS[tile.kind];
    const synced = this._syncDraftFromGrid();
    // If this tile came from a palette drag-drop, place it where it was
    // dropped; otherwise append at the next free row.
    const drop = this._pendingDropLayout;
    this._pendingDropLayout = undefined;
    const layout = drop
      ? { x: drop.x, y: drop.y, w: drop.w || def.w, h: drop.h || def.h }
      : {
          x: 0,
          y: synced.reduce((acc, t) => Math.max(acc, t.layout.y + t.layout.h), 0),
          w: def.w,
          h: def.h,
        };
    const entry: DashboardTileEntry = {
      id: crypto.randomUUID(),
      layout,
      tile,
      // Image tiles default to a transparent background so the picture is
      // shown without a competing colored frame; users can still cycle to an
      // accent color via the tile header button.
      ...(tile.kind === 'image' ? { color: 'transparent' } : {}),
    };
    this._draftTiles = [...synced, entry];
  }

  /**
   * Toggle the locked/fixed flag on a tile. Apply the change to gridstack
   * imperatively (grid.update) so listeners stay attached — destroying and
   * re-initing the grid stacks listeners and is the source of the "two tiles
   * dragging together" bug.
   */
  private _toggleTileFixed(id: string) {
    const synced = this._syncDraftFromGrid();
    this._draftTiles = synced.map((t) => (t.id === id ? { ...t, fixed: !t.fixed } : t));
    if (this._grid) {
      const el = this._grid.getGridItems().find((e) => e.getAttribute('gs-id') === id);
      const target = this._draftTiles.find((t) => t.id === id);
      if (el && target) {
        this._grid.update(el, { noMove: !!target.fixed, noResize: !!target.fixed });
      }
    }
  }

  /**
   * Toggle fill-height on a tile. Only allowed when the tile is bottom-most
   * (nothing below it) — otherwise it's a no-op and the button is disabled.
   * When turned on, the tile grows to the bottom of the visible dashboard;
   * when off, it keeps its current height.
   */
  private _toggleTileFillHeight(id: string) {
    const synced = this._syncDraftFromGrid();
    const target = synced.find((t) => t.id === id);
    if (!target) return;
    // Guard: only toggle on if eligible.
    if (!target.fillHeight && !canFillHeight(target, synced)) return;
    this._draftTiles = synced.map((t) => (t.id === id ? { ...t, fillHeight: !t.fillHeight } : t));
    this._applyAllFills();
  }

  private _fillButtonTitle(entry: DashboardTileEntry, eligible: boolean): string {
    if (entry.fillHeight) return msg('Stop filling height');
    if (!eligible) return msg('Fill height (only when nothing is below this tile)');
    return msg('Fill height');
  }

  /**
   * Cycle the tile's accent color on each click.
   * why: color is purely a content concern — gridstack doesn't track it, so
   * we DON'T destroy/re-init the grid. Updating _draftTiles in place is
   * enough; Lit re-renders only the affected tile-content element and the
   * grid stays alive (no listener stacking, no flash-of-empty layout).
   */
  private _cycleTileColor(id: string) {
    this._draftTiles = this._draftTiles.map((t) =>
      t.id === id ? { ...t, color: nextTileColor(t.color) } : t,
    );
  }

  /**
   * Remove a tile. why: call grid.removeWidget BEFORE Lit removes the DOM
   * (otherwise gridstack ends up with a dangling node reference). We DON'T
   * destroy/re-init the grid — see _addTile for the listener-stacking issue.
   */
  private _removeTile(id: string) {
    const synced = this._syncDraftFromGrid();
    if (this._grid) {
      const el = this._grid.getGridItems().find((e) => e.getAttribute('gs-id') === id);
      if (el) this._grid.removeWidget(el, false);
    }
    this._draftTiles = synced.filter((t) => t.id !== id);
  }

  /**
   * Best-effort resolution of the applet/group that owns `wal`, used to stamp
   * a wal-embed tile so a viewer who hasn't activated the owning Tool sees a
   * friendly "Activate to load" UI instead of a generic "Asset not found".
   * Returns `undefined` if the WAL's DNA isn't installed locally (which would
   * be unusual here — the user just picked the asset from their own pocket).
   */
  private async _resolveWalSourceHints(
    wal: WAL,
  ): Promise<{ srcAppletHash: string; srcGroupDnaHash: string } | undefined> {
    try {
      const location = (await toPromise(
        this._groupStore.mossStore.dnaLocations.get(wal.hrl[0])!,
      )) as DnaLocation;
      return {
        srcAppletHash: encodeHashToBase64(location.appletHash),
        srcGroupDnaHash: encodeHashToBase64(this._groupStore.groupDnaHash),
      };
    } catch (e) {
      console.warn('[group-dashboard] could not resolve source applet for WAL:', e);
      return undefined;
    }
  }

  private async _pickWalForTile() {
    try {
      const wal = await this._openViews.userSelectWal('pocket');
      if (!wal) return;
      // The pocket dialog dispatches `wal-selected` and *then* hides — the
      // close animation overlaps with this resume. Destroying/re-initing the
      // gridstack synchronously here races with sl-dialog's backdrop teardown
      // and can leave the page non-interactive. Yield twice (microtask +
      // animation frame) so Shoelace can finish removing its modal `inert`
      // before we mutate the layout below.
      await Promise.resolve();
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const hints = await this._resolveWalSourceHints(wal);
      this._addTile({ kind: 'wal-embed', wal: weaveUrlFromWal(wal), ...hints });
    } catch (e) {
      console.error('Failed to pick WAL:', e);
      notifyError(msg('Failed to pick asset.'));
    }
  }

  /**
   * Edit-equivalent for an existing wal-embed tile: open the asset picker and
   * replace the tile's WAL with the picked one. Layout / id / fixed / color
   * are preserved.
   */
  private async _pickWalReplacement(id: string) {
    try {
      const wal = await this._openViews.userSelectWal('pocket');
      if (!wal) return;
      await Promise.resolve();
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const hints = await this._resolveWalSourceHints(wal);
      this._replaceTile(id, { kind: 'wal-embed', wal: weaveUrlFromWal(wal), ...hints });
    } catch (e) {
      console.error('Failed to pick WAL replacement:', e);
      notifyError(msg('Failed to pick asset.'));
    }
  }

  /**
   * The add/edit dialog confirmed a tile (already validated). Apply it to the
   * draft — replacing the edited tile or appending a new one — and close.
   */
  private _onTileConfirmed(e: CustomEvent<{ tile: DashboardTile; editingId?: string }>) {
    const { tile, editingId } = e.detail;
    this._dialogDraft = null;
    this._dialogEditingId = undefined;
    if (editingId !== undefined) {
      this._replaceTile(editingId, tile);
    } else {
      this._addTile(tile);
    }
  }

  private _closeTileDialog() {
    this._dialogDraft = null;
    this._dialogEditingId = undefined;
  }

  /**
   * Open the add-tile dialog pre-populated with an existing tile's contents.
   * Only supports markdown/image/iframe — WAL tiles can be re-picked via
   * delete-then-add.
   */
  private _editTile(entry: DashboardTileEntry) {
    if (entry.tile.kind === 'wal-embed') {
      notifyError(msg('Asset tiles can only be deleted and re-picked.'));
      return;
    }
    switch (entry.tile.kind) {
      case 'markdown':
        this._dialogDraft = { kind: 'markdown', source: entry.tile.source };
        break;
      case 'image':
        this._dialogDraft = {
          kind: 'image',
          src: entry.tile.src,
          alt: entry.tile.alt ?? '',
        };
        break;
      case 'iframe':
        this._dialogDraft = { kind: 'iframe', src: entry.tile.src };
        break;
    }
    this._dialogEditingId = entry.id;
  }

  /**
   * Replace the tile content for `id` while preserving its layout. We don't
   * touch gridstack here — the tile body re-renders via Lit and the grid
   * cell stays in place.
   */
  private _replaceTile(id: string, tile: DashboardTile) {
    const synced = this._syncDraftFromGrid();
    this._draftTiles = synced.map((t) => (t.id === id ? { ...t, tile } : t));
  }

  private _renderTileBody(tile: DashboardTile) {
    switch (tile.kind) {
      case 'wal-embed':
        // why: `bare` skips wal-embed's own chrome (top-bar with collapse/
        // expand buttons) since our tile already has its own header. Without
        // bare, the embedded iframe ends up inside an extra resize wrapper
        // that fights with gridstack's cell sizing.
        return html`<wal-embed
          .src=${tile.wal}
          .srcAppletHash=${tile.srcAppletHash}
          .srcGroupDnaHash=${tile.srcGroupDnaHash}
          bare
          style="display:block; height:100%; width:100%;"
        ></wal-embed>`;
      case 'markdown':
        // why: markdownParseSafe runs marked then DOMPurify.sanitize (see
        // utils.ts), which strips <script>, inline event handlers, and
        // javascript:/data: URLs. That sanitizer — not unsafeHTML — is what
        // makes rendering steward-authored markdown safe; don't layer another.
        return html`<div class="markdown-tile">${unsafeHTML(markdownParseSafe(tile.source))}</div>`;
      case 'image':
        // referrerpolicy: don't leak the viewing member's referrer to the
        // image host. The host still sees the viewer's IP on the request.
        return html`<img
          src=${tile.src}
          alt=${tile.alt ?? ''}
          referrerpolicy="no-referrer"
          style="width:100%; height:100%; object-fit: contain;"
        />`;
      case 'iframe':
        // sandbox without allow-same-origin: the framed page runs scripts in an
        // opaque origin so it can't reach this renderer's origin, storage, or
        // cookies. referrerpolicy avoids leaking the viewer's referrer.
        return html`<iframe
          src=${tile.src}
          sandbox="allow-scripts allow-forms allow-popups"
          referrerpolicy="no-referrer"
          style="border:0; width:100%; height:100%;"
        ></iframe>`;
    }
  }

  private _renderReadOnly(tiles: DashboardTileEntry[]) {
    if (tiles.length === 0) {
      return html`<div class="empty-state">
        ${msg('No tiles on this group home yet.')}
        ${this._amIPrivileged()
          ? html`<span class="empty-hint"
              >${msg('Use the pencil button in the header to add tiles.')}</span
            >`
          : nothing}
      </div>`;
    }
    return html`
      <div class="grid-stack" id="grid-root-static">
        ${repeat(
          tiles,
          (t) => t.id,
          (t) => html`
            <div
              class="grid-stack-item"
              gs-id=${t.id}
              gs-x=${t.layout.x}
              gs-y=${t.layout.y}
              gs-w=${t.layout.w}
              gs-h=${t.layout.h}
              gs-no-resize="true"
              gs-no-move="true"
            >
              <div class="grid-stack-item-content tile-content" style=${tileColorStyle(t.color)}>
                ${this._renderTileBody(t.tile)}
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderEditing() {
    return html`
      <div class="edit-layout">
        <dashboard-palette
          .foyerEnabled=${this._draftFoyerEnabled}
          @foyer-toggled=${this._onFoyerToggled}
        ></dashboard-palette>
        <div class="grid-stack" id="grid-root">
          ${repeat(
            this._draftTiles,
            (t) => t.id,
            (t) => html`
              <div
                class="grid-stack-item ${t.fixed ? 'tile-fixed' : ''}"
                gs-id=${t.id}
                gs-x=${t.layout.x}
                gs-y=${t.layout.y}
                gs-w=${t.layout.w}
                gs-h=${t.layout.h}
                ?gs-no-move=${!!t.fixed}
                ?gs-no-resize=${!!t.fixed}
              >
                <div class="grid-stack-item-content tile-content" style=${tileColorStyle(t.color)}>
                  <div class="dash-grip tile-header ${t.fixed ? '' : 'tile-drag-handle'}">
                    ${t.fixed ? '' : html`<span class="dash-grip-dots">⠿</span>`}
                    <span class="tile-kind-label">${tileKindLabel(t.tile.kind)}</span>
                    <div class="tile-header-actions">
                      ${(() => {
                        const eligible = t.fillHeight || canFillHeight(t, this._draftTiles);
                        return html`<button
                          class="tile-header-btn ${t.fillHeight ? 'tile-header-btn-active' : ''}"
                          title=${this._fillButtonTitle(t, eligible)}
                          ?disabled=${!eligible}
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this._toggleTileFillHeight(t.id);
                          }}
                          @pointerdown=${(e: Event) => e.stopPropagation()}
                        >
                          <sl-icon
                            .src=${wrapPathInSvg(mdiArrowExpandVertical)}
                            style="font-size: 14px;"
                          ></sl-icon>
                        </button>`;
                      })()}
                      <button
                        class="tile-header-btn"
                        title=${msg('Cycle background color')}
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this._cycleTileColor(t.id);
                        }}
                        @pointerdown=${(e: Event) => e.stopPropagation()}
                      >
                        <sl-icon
                          .src=${wrapPathInSvg(mdiPaletteOutline)}
                          style="font-size: 14px;"
                        ></sl-icon>
                      </button>
                      <button
                        class="tile-header-btn"
                        title=${t.fixed
                          ? msg('Unlock (allow move/resize)')
                          : msg('Lock size & position')}
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this._toggleTileFixed(t.id);
                        }}
                        @pointerdown=${(e: Event) => e.stopPropagation()}
                      >
                        <sl-icon
                          .src=${wrapPathInSvg(t.fixed ? mdiLock : mdiLockOpenOutline)}
                          style="font-size: 14px;"
                        ></sl-icon>
                      </button>
                      <button
                        class="tile-header-btn"
                        title=${t.tile.kind === 'wal-embed'
                          ? msg('Replace asset')
                          : msg('Edit tile')}
                        @click=${(e: Event) => {
                          // why: stop drag-handle pointer event from picking
                          // up this click — clicking the edit button must
                          // open the dialog/picker, not start a drag.
                          e.stopPropagation();
                          if (t.tile.kind === 'wal-embed') {
                            void this._pickWalReplacement(t.id);
                          } else {
                            this._editTile(t);
                          }
                        }}
                        @pointerdown=${(e: Event) => e.stopPropagation()}
                      >
                        ${editIcon(14)}
                      </button>
                      <button
                        class="tile-header-btn"
                        title=${msg('Remove tile')}
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this._removeTile(t.id);
                        }}
                        @pointerdown=${(e: Event) => e.stopPropagation()}
                      >
                        ${closeIcon(14)}
                      </button>
                    </div>
                  </div>
                  <div class="tile-body">${this._renderTileBody(t.tile)}</div>
                </div>
              </div>
            `,
          )}
        </div>
      </div>
      <dashboard-tile-dialog
        .draft=${this._dialogDraft}
        .editingId=${this._dialogEditingId}
        @tile-confirmed=${this._onTileConfirmed}
        @dialog-closed=${this._closeTileDialog}
      ></dashboard-tile-dialog>
    `;
  }

  render() {
    const v = this._dashboard.value;
    if (v.status === 'pending') {
      return html`<div class="column center-content" style="flex:1;">${msg('Loading...')}</div>`;
    }
    if (v.status === 'error') {
      console.error(v.error);
      return html`<div class="column center-content" style="flex:1;">
        ${msg('Error loading group home.')}
      </div>`;
    }
    return html`
      ${dashboardStyles()}
      ${this._editing ? this._renderEditing() : this._renderReadOnly(this._readTiles())}
    `;
  }
}
