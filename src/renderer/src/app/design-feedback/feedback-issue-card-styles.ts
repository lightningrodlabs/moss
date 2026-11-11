import { css } from 'lit';

/**
 * Thread role colours and the inline unread badge for feedback-issue-card.
 * Card shape, hover and the expanded border come from toolSettingsStyles so a
 * feedback card looks like a Tool card in group settings.
 */
export const feedbackIssueCardStyles = css`
  .title-bar {
    padding: 6px;
    border-radius: 12px;
    cursor: pointer;
    gap: 12px;
  }
  .title-bar:hover {
    background: #f5f5f5;
  }
  .summary {
    flex: 1;
    min-width: 0;
    align-items: flex-start;
  }
  .title {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .feedback-date {
    font-size: 12px;
    opacity: 0.6;
  }
  .details-container {
    margin-left: 6px;
  }
  .original {
    white-space: pre-wrap;
    font-size: 14px;
  }
  .comment {
    padding: 4px 8px;
    border-left: 3px solid transparent;
    font-size: 14px;
  }
  .comment.team {
    border-left-color: var(--moss-purple);
  }
  .comment.reporter {
    border-left-color: var(--moss-main-green);
  }
  .comment.other {
    border-left-color: #9a9a9a;
  }
  .comment-author {
    font-weight: bold;
    font-size: 12px;
  }
  .deleted {
    font-style: italic;
    opacity: 0.6;
  }
  .notification-dot {
    font-weight: bold;
    background: var(--moss-purple);
    border-radius: 10px;
    height: 10px;
    min-width: 10px;
  }
  .urgent {
    height: 16px;
    min-width: 18px;
    border-radius: 4px;
    color: white;
    font-size: 12px;
    padding: 0 4px;
  }
  .link {
    font-size: 14px;
    white-space: nowrap;
  }
  .action-button {
    min-width: 140px;
  }
  .moss-button-secondary .dot-carousel {
    --carousel-color: black;
  }
`;
