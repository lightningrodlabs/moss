import { sharedStyles } from '@holochain-open-dev/elements';
import { css } from 'lit';
import '@fontsource/aileron';

export const weStyles = [
  sharedStyles,
  css`
    .default-font {
      font-family: 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
    }

    :host {
      /* for cards */
      --sl-border-radius-medium: 6px;
      --sl-shadow-x-small: 1px 1px 5px 0 #9b9b9b;

      /* for buttons */
      --sl-input-border-radius-medium: 6px;

      --sl-input-height-large: 60px;

      /* Fonts */
      --sl-font-mono: 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
    }
  `,
];
