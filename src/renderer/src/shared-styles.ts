import { sharedStyles } from '@holochain-open-dev/elements';
import { css } from 'lit';
import '@fontsource/aileron';
import '@fontsource-variable/inter';

export const weStyles = [
  sharedStyles,
  css`
    .default-font {
      font-family: 'Inter Variable', 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
    }

    :host {
      /* for cards */
      --sl-border-radius-medium: 6px;
      --sl-shadow-x-small: 1px 1px 5px 0 #9b9b9b;

      /* for buttons */
      --sl-input-border-radius-medium: 6px;

      --sl-input-height-large: 60px;

      /* Fonts */
      --sl-font-mono: 'Inter Variable', 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;

      /* Colors */
      --moss-main-green: #e0eed5;

      --moss-light-green: #f4fed6;

      --moss-grey-light: #e8e8e8;
      --moss-grey-dark: #757575;

      --moss-dark-button: #151a11;

      --moss-purple: #7461eb;
    }

    .items-center {
      align-items: center;
    }

    .justify-center {
      justify-content: center;
    }

    .flex {
      display: flex;
    }

    .flex-1 {
      flex: 1;
    }

    .font-bold {
      font-weight: bold;
    }

    /* Shoelace element styling */

    /* moss-button */

    .moss-button {
      all: unset;
      background: black;
      border-radius: 16px;
      padding: 16px 20px;
      font-size: 18px;
      font-weight: 500;
      line-height: 20px;
      color: white;
      cursor: pointer;
      text-align: center;
      --sl-color-neutral-0: black;
      --sl-color-primary-50: #455b36;
    }
    .moss-button:hover {
      background: #455b36;
    }
    .moss-button:disabled {
      opacity: 0.4;
      background: #4c6a39;
      cursor: default;
    }

    /* moss-dialog */

    .moss-dialog::part(panel) {
      border-radius: 20px;
    }

    /* moss-input */

    .moss-input {
      position: relative;
      /* For the label color to only show up on :focus-within the default color is transparent */
      color: transparent;
      /* color: var(--moss-grey-dark); */
    }
    .moss-input::part(base) {
      border-radius: 12px;
      border: 1px solid --moss-grey-light;
      font-size: 16px;
    }
    .moss-input::part(input) {
      color: black;
    }
    .moss-input {
      --sl-input-focus-ring-color: var(--moss-main-green);
      --sl-input-border-color-hover: var(--moss-dark-button);
      --sl-input-border-color-focus: var(--moss-dark-button);
      --sl-input-placeholder-color: var(--moss-grey-dark);
      --sl-input-height-medium: 52px;
    }
    .moss-input::part(form-control-label) {
      position: absolute;
      z-index: 1;
      font-size: 12px;
      margin-left: 16px;
      margin-top: 3px;
    }
    .moss-input:focus-within {
      /* make the form control label visible */
      color: var(--moss-grey-dark);
      --sl-input-placeholder-color: transparent;
    }
    .moss-input:focus-within {
      /* make the form control label visible */
      color: var(--moss-grey-dark);
      --sl-input-placeholder-color: transparent;
    }
    .moss-input::part(input):focus {
      margin-top: 3px;
    }
    /* .moss-input::part(form-control-input):placeholder-shown {
      background: blue;
    } */
    .moss-input::part(form-control-help-text) {
      margin-left: 14px;
      color: var(--moss-purple);
      font-size: 12px;
    }

    /* moss-hover-icon */

    .moss-hover-icon-button {
      all: unset;
      display: flex;
      flex-direction: row;
      align-items: center;
      cursor: pointer;
    }
    .moss-hover-icon-button:hover .moss-hover-icon-button-text {
      color: black;
    }
    .moss-hover-icon-button-text {
      color: transparent;
    }
    .moss-hover-icon-button-icon {
      border-radius: 8px;
      height: 24px;
    }
    .moss-hover-icon-button:hover .moss-hover-icon-button-icon {
      background: var(--moss-main-green);
    }

    /* moss dialog page indicator dots */

    .dialog-dot {
      height: 8px;
      width: 8px;
      border-radius: 50%;
      background-color: #d9d9d9;
    }

    /* image picker button */

    .image-picker-button {
      all: unset;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      height: 80px;
      width: 80px;
      cursor: pointer;
      border: 1px solid #778355;
      background-color: var(--moss-light-green);
    }

    .image-picker-img {
      border-radius: 12px;
      height: 80px;
      width: 80px;
    }

    /* color classes */

    .bg-black {
      background-color: black;
    }
  `,
];
