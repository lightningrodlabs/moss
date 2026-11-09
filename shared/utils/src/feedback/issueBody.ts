export type IssueBodyInput = {
  text: string;
  screenshotUrl: string;
  mossVersion: string;
  os: string;
  reporterId: string;
  githubHandle?: string;
};

/** Matches the hidden marker that ties an issue back to its reporter. */
export const REPORTER_MARKER_REGEX = /<!-- moss-feedback reporter=([A-Za-z0-9_-]{12}) -->/;

const TITLE_PREFIX = '[Design Feedback] ';
const TITLE_MAX_TEXT = 60;
const TITLE_KEPT_TEXT = 57;

/** Builds a GitHub issue title from the report text, shortened to stay readable in lists. */
export function buildIssueTitle(text: string): string {
  const snippet =
    text.length > TITLE_MAX_TEXT ? text.slice(0, TITLE_KEPT_TEXT) + '...' : text;
  return TITLE_PREFIX + snippet;
}

/**
 * Builds the issue body. The reporter marker is the last line so the
 * reporter can be recovered later when checking comment ownership.
 */
export function buildIssueBody(input: IssueBodyInput): string {
  const environment = [
    `- Moss version: ${input.mossVersion}`,
    `- OS: ${input.os}`,
    `- Reporter: \`${input.reporterId}\``,
  ];
  if (input.githubHandle) environment.push(`- GitHub: @${input.githubHandle}`);

  return [
    '## Design Feedback',
    '',
    input.text,
    '',
    '### Screenshot',
    '',
    `![screenshot](${input.screenshotUrl})`,
    '',
    '### Environment',
    '',
    ...environment,
    '',
    '---',
    '*Submitted via Moss Design Feedback Mode*',
    '',
    `<!-- moss-feedback reporter=${input.reporterId} -->`,
    '',
  ].join('\n');
}

/** Returns the reporter id embedded in an issue body, if any. */
export function parseReporterMarker(body: string): string | undefined {
  return REPORTER_MARKER_REGEX.exec(body)?.[1];
}
