import { css } from 'lit';

/**
 * The shared look of an "about" affordance: a `.info-icon` (ⓘ) beside a
 * heading that opens a moss-dialog whose content is a `.info-about` column of
 * paragraphs. Any pane that explains itself this way uses these rules so the
 * icon and the dialog read the same everywhere.
 */
export const infoAboutStyles = css`
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

  .info-about p {
    margin: 0;
    font-size: 16px;
    line-height: 1.5;
  }

  .info-about a {
    color: var(--moss-purple, #6200ea);
  }
`;
