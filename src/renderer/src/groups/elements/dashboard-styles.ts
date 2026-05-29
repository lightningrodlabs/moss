import { html, unsafeCSS } from 'lit';
// why: import gridstack's stylesheet as a raw string (not as a side-effect
// injection into document.head). The group-dashboard host element lives inside
// group-home's shadow root, and CSS in document.head doesn't cross shadow
// boundaries — so the default side-effect import leaves grid items and their
// resize handles entirely unstyled. We inject the raw text into a <style> block
// so the rules live in the same shadow tree as the items.
// @ts-ignore — `?inline` is a Vite-specific suffix.
import gridstackCss from 'gridstack/dist/gridstack.css?inline';
// @ts-ignore
import gridstackExtraCss from 'gridstack/dist/gridstack-extra.css?inline';

/**
 * Light-DOM styles for the group dashboard, injected once per render. Selectors
 * are scoped under `group-dashboard` so they only affect this subtree (the
 * element renders to light DOM). Includes the raw gridstack stylesheets.
 */
export function dashboardStyles() {
  return html`<style>
    ${unsafeCSS(gridstackCss as string)} ${unsafeCSS(gridstackExtraCss as string)} group-dashboard {
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
