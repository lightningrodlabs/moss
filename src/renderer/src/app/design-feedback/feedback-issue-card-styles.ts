import { css } from 'lit';

/** Card layout, thread role colours and the inline unread badge for feedback-issue-card. */
export const feedbackIssueCardStyles = css`
  .card {
    padding: 8px 12px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.05);
  }
  .summary {
    flex: 1;
    min-width: 0;
    align-items: flex-start;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
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
  .details {
    margin-top: 8px;
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
`;
