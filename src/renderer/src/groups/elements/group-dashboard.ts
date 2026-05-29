import { LitElement, html, nothing, PropertyValues } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { notifyError } from '@holochain-open-dev/elements';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { ActionHash } from '@holochain/client';
import { weaveUrlFromWal } from '@theweave/api';
import { GridStack, GridStackNode, GridStackOptions } from 'gridstack';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import {
  mdiLock,
  mdiLockOpenOutline,
  mdiPaletteOutline,
  mdiArrowExpandVertical,
} from '@mdi/js';
import { unsafeCSS } from 'lit';
// why: import gridstack's stylesheet as a raw string (not as a side-effect
// injection into document.head). group-dashboard's host element lives inside
// group-home's shadow root, and CSS in document.head doesn't cross shadow
// boundaries — so the default side-effect import leaves grid items and their
// resize handles entirely unstyled. We inject the raw text into our own
// <style> block below so the rules live in the same shadow tree as the items.
// @ts-ignore — `?inline` is a Vite-specific suffix.
import gridstackCss from 'gridstack/dist/gridstack.css?inline';
// @ts-ignore
import gridstackExtraCss from 'gridstack/dist/gridstack-extra.css?inline';

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
   * which is why document.head stylesheets can't reach it and the gridstack
   * CSS is injected as a scoped <style> block (see the gridstackCss import).
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
  /** Floating palette position (.edit-layout-relative px). Undefined = the
   * default bottom-left anchor. Session-only, not persisted. */
  @state() private _palettePos: { left: number; top: number } | undefined;
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

  disconnectedCallback() {
    super.disconnectedCallback();
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
    this._draftTiles =
      current && Array.isArray(current.tiles) ? structuredClone(current.tiles) : [];
    this._draftFoyerEnabled = current ? current.foyerEnabled !== false : true;
    this._palettePos = undefined;
    this._editing = true;
    this._emitEditingChanged();
  }

  /** Toggle the foyer on/off in the draft and tell group-home to reflect it
   * live. Persisted with the dashboard on save. */
  private _toggleFoyer(enabled: boolean) {
    this._draftFoyerEnabled = enabled;
    this.dispatchEvent(
      new CustomEvent('foyer-toggled', {
        detail: { enabled },
        bubbles: true,
        composed: true,
      }),
    );
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
    // Register the palette chips as drag-in sources. why: pass the actual
    // elements, NOT a selector — setupDragIn's selector path uses
    // document.querySelectorAll, which can't see the chips (they live in this
    // component's light DOM inside group-home's shadow root). Query them from
    // our own render root instead.
    const chipEls = Array.from(
      this.querySelectorAll<HTMLElement>('.dash-palette-item'),
    );
    if (chipEls.length) {
      // why a custom helper: gridstack's `helper: 'clone'` deep-clones the
      // chip and appends it to <body>. Some of our chip styling lives inside
      // a <style> nested in the dashboard subtree and (depending on cascade)
      // wasn't always applying to the clone — drag preview ended up as bare
      // text. Snapshot the chip's real rendered box (computed background,
      // border, radius, padding, font, dimensions) and inline those on a
      // fresh element so the drag preview always looks like the chip itself.
      const buildHelper = (el: HTMLElement): HTMLElement => {
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const helper = el.cloneNode(true) as HTMLElement;
        helper.style.boxSizing = 'border-box';
        helper.style.width = `${rect.width}px`;
        helper.style.height = `${rect.height}px`;
        helper.style.background = cs.background;
        helper.style.border = cs.border;
        helper.style.borderLeft = cs.borderLeft;
        helper.style.borderRadius = cs.borderRadius;
        helper.style.padding = cs.padding;
        helper.style.color = cs.color;
        helper.style.font = cs.font;
        helper.style.display = 'flex';
        helper.style.alignItems = 'center';
        helper.style.justifyContent = 'center';
        helper.style.textAlign = 'center';
        helper.style.opacity = '0.92';
        helper.style.boxShadow = '0 6px 18px rgba(0,0,0,0.25)';
        return helper;
      };
      GridStack.setupDragIn(chipEls, { appendTo: 'body', helper: buildHelper });
    }
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
    this._applyAllFills();
  }

  /** The grid instance for whichever mode is active. */
  private _activeGrid(): GridStack | undefined {
    return this._editing ? this._grid : this._staticGrid;
  }

  /** The tiles backing whichever mode is active. */
  private _activeTiles(): DashboardTileEntry[] {
    if (this._editing) return this._draftTiles;
    const v = this._dashboard.value;
    return v.status === 'complete' && v.value ? v.value.tiles ?? [] : [];
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
        const box = node.offsetParent instanceof HTMLElement ? node.offsetParent : node.parentElement;
        const bottom = (box ?? node).getBoundingClientRect().bottom;
        return Math.min(bottom, window.innerHeight) - 4;
      }
      node = node.parentElement;
    }
    return window.innerHeight - 4;
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
      await this._groupStore.groupClient.setGroupDashboard(
        this._getMyPermissionHash(),
        dashboard,
      );
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
    this._draftTiles = synced.map((t) =>
      t.id === id ? { ...t, fillHeight: !t.fillHeight } : t,
    );
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
      this._addTile({ kind: 'wal-embed', wal: weaveUrlFromWal(wal) });
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
      this._replaceTile(id, { kind: 'wal-embed', wal: weaveUrlFromWal(wal) });
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
          bare
          style="display:block; height:100%; width:100%;"
        ></wal-embed>`;
      case 'markdown':
        // why: markdownParseSafe runs marked then DOMPurify.sanitize (see
        // utils.ts), which strips <script>, inline event handlers, and
        // javascript:/data: URLs. That sanitizer — not unsafeHTML — is what
        // makes rendering steward-authored markdown safe; don't layer another.
        return html`<div class="markdown-tile">
          ${unsafeHTML(markdownParseSafe(tile.source))}
        </div>`;
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
              <div
                class="grid-stack-item-content tile-content"
                style=${tileColorStyle(t.color)}
              >
                ${this._renderTileBody(t.tile)}
              </div>
            </div>
          `,
    )}
      </div>
    `;
  }

  private _renderPalette() {
    // why: chips carry gs-w/gs-h so the dropped widget gets a sensible default
    // size, and data-kind so the dropped handler knows what tile to create.
    const chip = (kind: DashboardTile['kind']) => ({
      kind,
      label: tileKindLabel(kind),
      w: DEFAULT_LAYOUTS[kind].w,
      h: DEFAULT_LAYOUTS[kind].h,
    });
    const chips = [chip('markdown'), chip('image'), chip('wal-embed'), chip('iframe')];
    const pos = this._palettePos;
    const posStyle = pos
      ? `left:${pos.left}px; top:${pos.top}px; bottom:auto;`
      : `left:12px; bottom:12px; top:auto;`;
    return html`
      <div class="dash-palette" style=${posStyle}>
        <div class="dash-grip palette-grip" @pointerdown=${(e: PointerEvent) => this._startPaletteDrag(e)}>
          <span class="dash-grip-dots">⠿</span>
          <span class="palette-grip-label">${msg('Palette')}</span>
        </div>
        <div class="palette-body">
          <div class="palette-section-title">${msg('Add')}</div>
          ${chips.map(
      (c) => html`
              <div
                class="dash-palette-item"
                data-kind=${c.kind}
                gs-w=${c.w}
                gs-h=${c.h}
                title=${msg('Drag onto the board')}
              >
                ${c.label}
              </div>
            `,
    )}
          <div class="palette-section-title">${msg('Options')}</div>
          <label class="palette-option">
            <input
              type="checkbox"
              .checked=${this._draftFoyerEnabled}
              @change=${(e: Event) => this._toggleFoyer((e.target as HTMLInputElement).checked)}
            />
            ${msg('Foyer (chat)')}
          </label>
        </div>
      </div>
    `;
  }

  /**
   * Drag the floating palette around by its grip. Positions are kept in
   * .edit-layout-relative px (clamped inside it) and held only for the edit
   * session (not persisted).
   */
  private _startPaletteDrag(e: PointerEvent) {
    e.preventDefault();
    const palette = (e.currentTarget as HTMLElement).closest('.dash-palette') as HTMLElement | null;
    const container = this._editing ? this._gridEl?.closest('.edit-layout') : null;
    if (!palette || !(container instanceof HTMLElement)) return;
    const cRect = container.getBoundingClientRect();
    const pRect = palette.getBoundingClientRect();
    const grabDx = e.clientX - pRect.left;
    const grabDy = e.clientY - pRect.top;
    const move = (ev: PointerEvent) => {
      let left = ev.clientX - cRect.left - grabDx;
      let top = ev.clientY - cRect.top - grabDy;
      // keep it within the container
      left = Math.max(0, Math.min(left, cRect.width - pRect.width));
      top = Math.max(0, Math.min(top, cRect.height - pRect.height));
      this._palettePos = { left, top };
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  private _renderEditing() {
    return html`
      <div class="edit-layout">
      ${this._renderPalette()}
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
              <div
                class="grid-stack-item-content tile-content"
                style=${tileColorStyle(t.color)}
              >
                <div class="dash-grip tile-header ${t.fixed ? '' : 'tile-drag-handle'}">
                  ${t.fixed ? '' : html`<span class="dash-grip-dots">⠿</span>`}
                  <span class="tile-kind-label"
                    >${tileKindLabel(t.tile.kind)}</span
                  >
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
                      title=${t.fixed ? msg('Unlock (allow move/resize)') : msg('Lock size & position')}
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
                      title=${t.tile.kind === 'wal-embed' ? msg('Replace asset') : msg('Edit tile')}
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
    const tiles = v.value?.tiles ?? [];
    return html`
      ${this._stylesTemplate()}
      ${this._editing ? this._renderEditing() : this._renderReadOnly(tiles)}
    `;
  }

  private _stylesTemplate() {
    return html`<style>
      ${unsafeCSS(gridstackCss as string)}
      ${unsafeCSS(gridstackExtraCss as string)}
      group-dashboard {
        display: block;
        flex: 1;
        min-height: 0;
        /* fill .home-panel so the floating palette can anchor to the visible
           board's bottom, not just the (short) grid content height */
        height: 100%;
        box-sizing: border-box;
      }
      /* edit-mode layout: grid fills, palette floats over it (bottom-left) */
      group-dashboard .edit-layout {
        position: relative;
        height: 100%;
      }
      /* In edit mode the grid must occupy the full visible area so palette
         chips can be dropped anywhere — not just on existing rows. Without
         this, an empty/short grid collapses to content height (0px when
         empty) and never receives mouseenter, so gridstack's drop chain
         (dropover → drop → 'dropped') never fires. */
      group-dashboard .edit-layout > .grid-stack {
        min-height: 100%;
      }
      group-dashboard .dash-palette {
        position: absolute;
        z-index: 20;
        width: 110px;
        box-sizing: border-box;
        background: var(--sl-color-neutral-0, #fff);
        border: 1px solid var(--sl-color-neutral-300, #ddd);
        border-radius: 8px;
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.32);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      /* Shared "grip bar" used by both the floating palette header and each
         tile's drag handle, so the affordance reads the same everywhere. */
      group-dashboard .dash-grip {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: var(--sl-color-neutral-100, #f4f4f4);
        font-size: 12px;
        line-height: 1;
        color: var(--sl-color-neutral-600, #555);
        cursor: move;
        user-select: none;
      }
      /* Force every child of the grip bar onto the same vertical baseline:
         action buttons or icons could otherwise stretch the row and shift the
         dots/label off-center relative to each other. */
      group-dashboard .dash-grip > * {
        line-height: 1;
        display: inline-flex;
        align-items: center;
      }
      group-dashboard .dash-grip:active {
        cursor: grabbing;
      }
      group-dashboard .dash-grip-dots {
        font-size: 14px;
        line-height: 1;
      }
      /* Palette grip gets a separator from its body. */
      group-dashboard .palette-grip {
        border-bottom: 1px solid var(--sl-color-neutral-200, #e5e5e5);
      }
      group-dashboard .palette-body {
        padding: 8px 10px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 60vh;
        overflow-y: auto;
      }
      group-dashboard .palette-section-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--sl-color-neutral-500, #888);
        margin-top: 4px;
      }
      group-dashboard .palette-hint {
        font-size: 11px;
        color: var(--sl-color-neutral-400, #aaa);
        margin-top: -4px;
      }
      /* Palette chip. why: no ancestor selector here — gridstack moves the
         dragged clone to body, where a group-dashboard ancestor rule would
         not match, and we want the dragged frame (border + background) to
         look the same as the chip sitting in the palette. */
      .dash-palette-item {
        box-sizing: border-box;
        margin-right: 2px;
        background: var(--sl-color-neutral-100, #f4f4f4);
        border-left: 2px solid var(--sl-color-neutral-300, #ddd);
        padding: 6px;
        font-size: 13px;
        cursor: grab;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .dash-palette-item:hover {
        background: var(--sl-color-neutral-200, #e5e5e5);
      }
      .dash-palette-item:active,
      .dash-palette-item.ui-draggable-dragging {
        cursor: grabbing;
      }
      group-dashboard .palette-option {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        cursor: pointer;
      }
      group-dashboard .grid-stack > .grid-stack-item > .grid-stack-item-content {
        inset: 6px;
        width: auto;
        height: auto;
      }
      group-dashboard .tile-content {
        display: flex;
        flex-direction: column;
        background: var(--moss-main-green);
        border: 1px solid var(--sl-color-neutral-200, #e5e5e5);
        border-radius: 8px;
        overflow: hidden;
        height: 100%;
      }
      /* Tile-header layout sits on top of the shared .dash-grip base. The
         action buttons get pushed to the right via margin-left:auto (rather
         than justify-content:space-between) so the dots + label on the left
         use the same flex gap as the palette grip and align identically. */
      group-dashboard .tile-header .tile-header-actions {
        margin-left: auto;
      }
      /* Fixed tiles aren't draggable, so the grip affordance is suppressed. */
      group-dashboard .tile-fixed > .grid-stack-item-content > .tile-header {
        cursor: default;
        background: var(--sl-color-warning-100, #fff8e1);
        color: var(--sl-color-warning-800, #856404);
      }
      group-dashboard .tile-kind-label {
        font-weight: 500;
      }
      group-dashboard .tile-header-actions {
        display: flex;
        gap: 4px;
      }
      group-dashboard .tile-header-btn {
        all: unset;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 4px;
        color: var(--sl-color-neutral-700, #444);
        display: inline-flex;
        align-items: center;
      }
      group-dashboard .tile-header-btn:hover {
        background: var(--sl-color-neutral-200, #e5e5e5);
      }
      group-dashboard .tile-header-btn-active {
        background: var(--sl-color-primary-200, #c7e0c0);
        color: var(--sl-color-primary-800, #2c4a25);
      }
      group-dashboard .tile-header-btn[disabled] {
        opacity: 0.3;
        cursor: default;
        pointer-events: none;
      }
      /* Slight z-index bump so corner arrow icons sit above the tile content
         border. Position + sizing comes from gridstack's own CSS, which is
         injected at the top of this stylesheet. */
      group-dashboard .grid-stack-item > .ui-resizable-handle {
        z-index: 5;
      }
      group-dashboard .tile-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      group-dashboard .markdown-tile {
        padding: 0 12px;
      }
      group-dashboard .add-tile-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      group-dashboard .add-tile-panel {
        position: relative;
        background: var(--sl-color-neutral-0, #fff);
        border-radius: 16px;
        padding: 40px 60px;
        width: 560px;
        max-width: calc(100vw - 64px);
        max-height: calc(100vh - 64px);
        overflow-y: auto;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      group-dashboard .add-tile-close {
        all: unset;
        position: absolute;
        top: 12px;
        right: 12px;
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        color: var(--sl-color-neutral-700, #444);
      }
      group-dashboard .add-tile-close:hover {
        background: var(--sl-color-neutral-100, #f4f4f4);
      }
      group-dashboard .add-tile-title {
        font-size: 24px;
        font-weight: 600;
        text-align: center;
        color: var(--sl-color-neutral-900, #111);
      }
      group-dashboard .empty-hint {
        font-size: 13px;
        color: var(--sl-color-neutral-500, #888);
        margin-top: 8px;
      }
      group-dashboard .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 60px 20px;
        color: var(--sl-color-neutral-600, #555);
      }
    </style>`;
  }
}
