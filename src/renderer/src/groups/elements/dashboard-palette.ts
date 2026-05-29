import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { GridStack } from 'gridstack';
import { DashboardTile } from '@theweave/group-client';

import { DEFAULT_LAYOUTS, tileKindLabel } from './dashboard-tile-utils.js';

/**
 * Floating edit-mode palette: draggable tile-kind chips (drag a chip onto the
 * board to add a tile) plus dashboard-level options (foyer toggle). Rendered
 * only while group-dashboard is in edit mode, so it is created fresh each edit
 * session — its drag position resets each time.
 *
 * Renders to light DOM so it shares group-dashboard's injected `.dash-palette*`
 * styles and so its chips live in the same (non-shadow) subtree the grid scans.
 *
 * Communicates with group-dashboard via:
 * - the chips themselves are registered as gridstack drag-in sources here, and
 *   the parent grid accepts them (`acceptWidgets: '.dash-palette-item'`) and
 *   handles the resulting `dropped` event;
 * - `foyer-toggled` (bubbles, composed) — detail `{ enabled }`.
 */
@localized()
@customElement('dashboard-palette')
export class DashboardPalette extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  /** Current foyer-enabled state, reflected by the checkbox. */
  @property({ type: Boolean }) foyerEnabled = true;

  /** Floating position (.edit-layout-relative px). Undefined = default anchor. */
  @state() private _pos: { left: number; top: number } | undefined;

  private _dragInRegistered = false;

  firstUpdated() {
    this._registerChipDragIn();
  }

  /**
   * Register the rendered chips as gridstack drag-in sources. why: pass the
   * actual elements, NOT a selector — setupDragIn's selector path uses
   * document.querySelectorAll, which can't see the chips (they live in light
   * DOM inside group-home's shadow root). The parent grid, inited separately,
   * accepts them via acceptWidgets and fires its own `dropped` handler.
   */
  private _registerChipDragIn() {
    if (this._dragInRegistered) return;
    const chipEls = Array.from(this.querySelectorAll<HTMLElement>('.dash-palette-item'));
    if (!chipEls.length) return;
    // why a custom helper: gridstack's `helper: 'clone'` deep-clones the chip
    // and appends it to <body>, where the nested dashboard <style> may not
    // apply — drag preview ended up as bare text. Snapshot the chip's real
    // rendered box and inline it so the preview always looks like the chip.
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
    this._dragInRegistered = true;
  }

  private _toggleFoyer(enabled: boolean) {
    this.dispatchEvent(
      new CustomEvent('foyer-toggled', {
        detail: { enabled },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Drag the floating palette around by its grip. Positions are kept in
   * .edit-layout-relative px (clamped inside it) and held only for the edit
   * session (not persisted).
   */
  private _startDrag(e: PointerEvent) {
    e.preventDefault();
    const palette = (e.currentTarget as HTMLElement).closest('.dash-palette') as HTMLElement | null;
    const container = this.closest('.edit-layout');
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
      this._pos = { left, top };
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  render() {
    // why: chips carry gs-w/gs-h so the dropped widget gets a sensible default
    // size, and data-kind so the dropped handler knows what tile to create.
    const chip = (kind: DashboardTile['kind']) => ({
      kind,
      label: tileKindLabel(kind),
      w: DEFAULT_LAYOUTS[kind].w,
      h: DEFAULT_LAYOUTS[kind].h,
    });
    const chips = [chip('markdown'), chip('image'), chip('wal-embed'), chip('iframe')];
    const pos = this._pos;
    const posStyle = pos
      ? `left:${pos.left}px; top:${pos.top}px; bottom:auto;`
      : `left:12px; bottom:12px; top:auto;`;
    return html`
      <div class="dash-palette" style=${posStyle}>
        <div class="dash-grip palette-grip" @pointerdown=${(e: PointerEvent) => this._startDrag(e)}>
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
              .checked=${this.foyerEnabled}
              @change=${(e: Event) => this._toggleFoyer((e.target as HTMLInputElement).checked)}
            />
            ${msg('Foyer (chat)')}
          </label>
        </div>
      </div>
    `;
  }
}
