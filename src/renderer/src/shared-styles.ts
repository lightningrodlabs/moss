import { sharedStyles } from '@holochain-open-dev/elements';
import { css } from 'lit';
import '@fontsource/aileron';
import '@fontsource-variable/inter';

export const mossStyles = [
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

      --moss-inactive-green: #b7c3b0;

      --moss-medium-green: #85b46e;

      --moss-fishy-green: #bac9af;

      --moss-dark-green: #1c251e;

      --moss-hint-green: #324d47;

      --moss-grey-green: #4c6a39;

      --moss-grey-light: #e8e8e8;
      --moss-grey-dark: #757575;

      --moss-dark-button: #151a11;

      --moss-purple: #7461eb;
      --moss-purple-semi-transparent: #2d2941;

      --moss-field-grey: #f4f4f4;

      /* shoelace dialog overlay background */
      --sl-overlay-background-color: #324d4781;

      /* tooltip border radius */
      --sl-tooltip-border-radius: 8px;
    }

    .items-center {
      align-items: center;
    }

    .items-start {
      align-items: flex-start;
    }

    .items-end {
      align-items: flex-end;
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

    /* Invisible scrollbars */

    .invisible-scrollbars {
      -ms-overflow-style: none; /* IE and Edge */
      scrollbar-width: none; /* Firefox */
    }

    .invisible-scrollbars::-webkit-scrollbar {
      display: none;
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
      background: var(--moss-grey-green);
      cursor: default;
    }

    .moss-button:focus-visible {
      outline: 2px solid var(--moss-purple);
    }

    /* moss-button-secondary */

    .moss-button-secondary {
      all: unset;
      border-radius: 16px;
      padding: 14px 18px;
      font-size: 18px;
      font-weight: 500;
      line-height: 20px;
      color: black;
      border: 2px solid #334128;
      cursor: pointer;
      background: transparent;
    }

    .moss-button-secondary:hover {
      background: #f2ffd8;
    }

    .moss-button-secondary:disabled {
      opacity: 0.4;
      cursor: default;
      background: transparent;
    }

    .moss-button-secondary:focus-visible {
      outline: 2px solid var(--moss-purple);
    }

    /* moss-card */

    .moss-card {
      background: white;
      border-radius: 20px;
      padding: 20px;
    }

    /* moss-dialog */

    .moss-dialog {
      color: black;
    }

    .moss-dialog::part(panel) {
      border-radius: 20px;
      background: white;
    }

    .moss-dialog::part(title) {
      font-size: 26px;
      font-weight: 500;
      letter-spacing: -0.56px;
    }

    /* dialog-title */

    .dialog-title {
      font-size: 28px;
      font-weight: 500;
      letter-spacing: -0.56px;
      text-align: center;
    }

    /* moss-input */

    .moss-input {
      position: relative;
      /* For the label color to only show up on :focus-within the default color is transparent */
      /* color: transparent; */
      color: var(--moss-grey-dark);
    }
    .moss-input::part(base) {
      border-radius: 12px;
      border: 1px solid --moss-grey-light;
      font-size: 16px;
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
      margin-left: 17px;
      margin-top: 3px;
    }
    .moss-input:focus-within {
      /* hide the placeholder */
      --sl-input-placeholder-color: transparent;
    }
    .moss-input::part(input) {
      color: black;
    }
    .moss-input::part(input):placeholder-shown {
      color: var(--moss-grey-dark);
      z-index: 1;
    }
    .moss-input::part(input):focus {
      /* let the label shine through */
      background: transparent;
      margin-top: 3px;
    }
    .moss-input::part(input):not(:placeholder-shown) {
      /* let the label shine through */
      background: transparent;
      margin-top: 3px;
    }
    .moss-input::part(form-control-help-text) {
      margin-left: 14px;
      color: var(--moss-purple);
      font-size: 12px;
    }

    /* moss-input-no-label */

    .moss-input-no-label {
      position: relative;
      /* For the label color to only show up on :focus-within the default color is transparent */
      /* color: transparent; */
      color: var(--moss-grey-dark);
    }
    .moss-input-no-label::part(base) {
      border-radius: 12px;
      border: 1px solid --moss-grey-light;
      font-size: 16px;
    }
    .moss-input-no-label {
      --sl-input-focus-ring-color: var(--moss-main-green);
      --sl-input-border-color-hover: var(--moss-dark-button);
      --sl-input-border-color-focus: var(--moss-dark-button);
      --sl-input-placeholder-color: var(--moss-grey-dark);
      --sl-input-height-medium: 52px;
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

    /* moss dialog close button */

    .moss-dialog-close-button {
      all: unset;
      display: flex;
      flex-direction: row;
      align-items: center;
      cursor: pointer;
      border-radius: 8px;
      height: 24px;
    }
    .moss-dialog-close-button:hover {
      background: var(--moss-main-green);
    }

    /* moss dialog page indicator dots */

    .dialog-dot {
      height: 8px;
      width: 8px;
      border-radius: 50%;
      background-color: #d9d9d9;
    }

    /* radio button styles */
    sl-radio {
      /* --sl-input-background-color: var(--moss-main-green); */
      --sl-color-neutral-0: black;
      --sl-color-primary-600: var(--moss-main-green);
      --sl-input-background-color: var(--moss-main-green);
      --sl-color-primary-500: var(--moss-main-green);
      --sl-input-background-color-hover: var(--moss-light-green);
    }

    /* sidebar buttons */

    .moss-sidebar-button {
      all: unset;
      cursor: pointer;
      height: 48px;
      width: 48px;
      color: #fff;
      border-radius: 12px;
    }

    .moss-sidebar-button:hover {
      background: var(--moss-dark-button);
    }

    .moss-sidebar-button:focus-visible {
      outline: 2px solid var(--moss-purple);
      background: var(--moss-dark-button);
    }

    /* Loading dots for buttons */
    /* https://codepen.io/nzbin/pen/GGrXbp */

    .dot-carousel {
      position: relative;
      left: -9999px;
      width: 10px;
      height: 10px;
      border-radius: 5px;
      background-color: var(--carousel-color, #ffffff);
      color: var(--carousel-color, #ffffff);
      box-shadow:
        9984px 0 0 0 var(--carousel-color, #ffffff),
        9999px 0 0 0 var(--carousel-color, #ffffff),
        10014px 0 0 0 var(--carousel-color, #ffffff);
      animation: dot-carousel 1.5s infinite linear;
    }

    @keyframes dot-carousel {
      0% {
        box-shadow:
          9984px 0 0 -1px var(--carousel-color, #ffffff),
          9999px 0 0 1px var(--carousel-color, #ffffff),
          10014px 0 0 -1px var(--carousel-color, #ffffff);
      }
      50% {
        box-shadow:
          10014px 0 0 -1px var(--carousel-color, #ffffff),
          9984px 0 0 -1px var(--carousel-color, #ffffff),
          9999px 0 0 1px var(--carousel-color, #ffffff);
      }
      100% {
        box-shadow:
          9999px 0 0 1px var(--carousel-color, #ffffff),
          10014px 0 0 -1px var(--carousel-color, #ffffff),
          9984px 0 0 -1px var(--carousel-color, #ffffff);
      }
    }

    /* color classes */

    .bg-black {
      background-color: black;
    }
  `,
];
