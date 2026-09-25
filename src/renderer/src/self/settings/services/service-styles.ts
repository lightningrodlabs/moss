import { css } from 'lit';

/**
 * The shared shape of a pane under Settings > Services, so every service
 * reads the same way and a new one only has to supply its content.
 *
 * A pane is a `.service-pane` column of `<section>`s. A section opens with
 * a `.service-heading` row — title, an optional `.info-icon` that opens an
 * about dialog, an optional switch — followed by a `.service-note` line of
 * explanation, then either `.service-rows` of `.service-row` cards or a
 * `.service-empty` line. Diagnostics belong in `.service-details` inside
 * the about dialog's technical-details section, not on the pane itself.
 */
export const serviceStyles = css`
  .service-pane {
    padding: 0 20px;
    gap: 24px;
  }

  .service-heading {
    align-items: center;
    gap: 12px;
  }

  .service-heading h3 {
    margin: 0;
    flex: 1;
  }

  .service-note {
    margin: 8px 0 0 0;
    opacity: 0.7;
    font-size: 13px;
    line-height: 1.5;
  }

  .info-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    font-size: 14px;
    cursor: pointer;
    color: var(--sl-color-neutral-600, #666);
    user-select: none;
  }

  .info-icon:hover {
    color: var(--moss-purple, #6200ea);
  }

  .service-rows {
    gap: 8px;
  }

  .service-row {
    padding: 10px 12px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.04);
    align-items: center;
    gap: 12px;
  }

  .service-row-name {
    font-weight: 500;
  }

  .service-row-meta {
    font-size: 12px;
    opacity: 0.6;
  }

  .service-empty {
    margin: 0;
    opacity: 0.7;
    font-size: 13px;
  }

  /* About dialog: plain-language paragraphs above a technical-details turn-down. */

  .service-about p {
    margin: 0;
    font-size: 16px;
    line-height: 1.5;
  }

  .service-about a {
    color: var(--moss-purple, #6200ea);
  }

  .service-details {
    font-family: monospace;
    font-size: 12px;
    line-height: 1.6;
    text-align: left;
    padding: 8px 0 0 0;
  }

  .service-error {
    color: var(--sl-color-danger-600, #b00);
    font-family: monospace;
  }
`;
