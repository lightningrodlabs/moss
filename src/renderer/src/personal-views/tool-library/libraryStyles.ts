import { css } from 'lit';
export const libraryStyles = [
  css`
    .tool-description {
      font-family: 'Inter Variable';
      font-size: 14px;
      font-style: normal;
      font-weight: 500;
      line-height: 14px; /* 133.333% */
      opacity: 0.6;
    }
    .tool-tag-list {
      flex-wrap: wrap;
    }
    .tool-tag {
      margin-right: 4px;
      margin-top: 4px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(137, 214, 188, 0.3);

      font-family: 'Inter Variable';
      font-size: 12px;
      font-style: normal;
      font-weight: 500;
      line-height: 16px; /* 133.333% */
    }

    .tool-developer {
      font-size: 14px;
      font-style: normal;
      font-weight: 500;
    }

    .tool-developer a {
      color: #324d47;
      text-decoration: none;
    }
    .tool-developer a:hover {
      text-decoration: underline;
    }
  `,
];
