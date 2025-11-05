import { css } from 'lit';
export const toolSettingsStyles = [
  css`
    .tool {
      border-radius: 20px;
      background: #fff;
      padding: 8px;
    }

    .tool:hover {
      background-color: var(--moss-field-grey);
    }
    .tool-expanded {
      border: 1px solid var(--moss-grey-light);
    }

    .installer,
    .participants {
      align-items: center;
    }

    .details-container {
      border-top: 1px solid var(--moss-grey-light);
      margin-top: 12px;
      padding-top: 12px;
      margin-left: 74px;
      
    }

    .tool-name {
      font-size: 16px;
      font-style: normal;
      font-weight: 600;
      line-height: 24px;
    }
    .tool-version {
      opacity: 0.5;
    }
    .tool-short-description {
      font-size: 12px;
      font-style: normal;
      font-weight: 500;
      opacity: 0.6;
    }
    .tool-deprecated {
      font-size: 11px;
      border-radius: 4px;
      background-color: rgba(116, 97, 235, 0.3);
      text-transform: uppercase;
      padding: 3px;
    }
  `,
];
