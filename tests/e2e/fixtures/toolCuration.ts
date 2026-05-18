import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { validateHappOrWebhapp } from '@lightningrodlabs/we-rust-utils';

/**
 * Local HTTP server that serves a tool-library curation pointing at the
 * locally-built example-applet.webhapp.
 *
 * why: the production tool curation lives at lightningrodlabs.org. For E2E we
 * want a deterministic, offline-capable fixture that points at our own example
 * applet — so the install flow exercised by smoke #4 doesn't depend on an
 * external CDN's uptime, and so the iframe/handshake assertions in #5 run
 * against an applet whose DOM we control.
 *
 * Endpoints (all under http://127.0.0.1:<port>/):
 *   GET /curations.json       -> top-level curation list
 *   GET /tool-list.json       -> developer collective + tool versions
 *   GET /example-applet.webhapp -> the binary
 *
 * Hashes in tool-list.json are computed from the actual bytes on disk at
 * server-start time — they must match exactly what the renderer's install
 * path validates, otherwise the install fails silently.
 */
export type RunningToolCuration = {
  baseUrl: string;
  curationUrl: string;
  /** From validateHappOrWebhapp — useful for tests that need to assert hashes. */
  hashes: { happSha256: string; webhappSha256?: string; uiSha256?: string };
  close: () => Promise<void>;
};

// 1×1 transparent PNG. Used as a stand-in for tool/curator/devcollective icons.
// why: validated bytes from a known-good source — earlier hand-rolled bytes
// failed Moss's PNG decoder ("unrecognised content at end of stream").
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WEBHAPP_PATH = path.join(REPO_ROOT, 'example', 'workdir', 'example-applet.webhapp');

export const FIXTURE_TOOL_ID = 'example-applet';
export const FIXTURE_TOOL_VERSION_BRANCH = '0.1.x';
export const FIXTURE_TOOL_VERSION = '0.1.0';
export const FIXTURE_TOOL_TITLE = 'Example Applet';

export async function startToolCurationServer(): Promise<RunningToolCuration> {
  if (!fs.existsSync(WEBHAPP_PATH)) {
    throw new Error(
      `Example webhapp not found at ${WEBHAPP_PATH}. Run \`yarn build:example-applet\` first.`,
    );
  }

  const webhappBytes = fs.readFileSync(WEBHAPP_PATH);
  const hashes = await validateHappOrWebhapp(Array.from(webhappBytes));

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (process.env.MOSS_E2E_DEBUG) {
      // eslint-disable-next-line no-console
      console.log(`[tool-curation-srv] ${req.method ?? 'GET'} ${url}`);
    }
    // why: the renderer runs from a custom moss:// protocol scheme; without
    // CORS allowance fetch() fails. Production CDN serves these headers.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url === '/curations.json') {
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(curationsBody(baseUrl)));
      return;
    }
    if (url === '/tool-list.json') {
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(toolListBody(baseUrl, hashes)));
      return;
    }
    if (url === '/example-applet.webhapp') {
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('cache-control', 'no-store');
      res.end(webhappBytes);
      return;
    }
    if (url.endsWith('.png')) {
      // why: Moss main process fetches the tool/curator/devcollective icons
      // during install-applet-bundle and fails the install if any return non-PNG
      // bytes (rust-utils' MIME sniff barfs on text/html 404 bodies). Serving a
      // valid 1×1 PNG keeps the install path happy without needing real assets.
      res.setHeader('content-type', 'image/png');
      res.setHeader('cache-control', 'no-store');
      res.end(ONE_BY_ONE_PNG);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    curationUrl: `${baseUrl}/curations.json`,
    hashes,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function curationsBody(baseUrl: string) {
  return {
    curator: {
      name: 'E2E Test Curator',
      description: 'Local fixture for the Playwright smoke suite.',
      contact: { website: 'http://127.0.0.1' },
      icon: `${baseUrl}/curator-icon.png`,
    },
    curationLists: {
      default: {
        name: 'Default',
        description: 'E2E fixture default list.',
        tags: [],
        tools: [
          {
            toolListUrl: `${baseUrl}/tool-list.json`,
            toolId: FIXTURE_TOOL_ID,
            versionBranch: FIXTURE_TOOL_VERSION_BRANCH,
            tags: ['e2e'],
          },
        ],
      },
    },
  };
}

function toolListBody(
  baseUrl: string,
  hashes: { happSha256: string; webhappSha256?: string; uiSha256?: string },
) {
  return {
    developerCollective: {
      id: 'e2e-fixture',
      name: 'E2E Fixture',
      description: 'Local fixture developer collective.',
      icon: `${baseUrl}/devcollective-icon.png`,
      contact: { website: 'http://127.0.0.1' },
    },
    tools: [
      {
        id: FIXTURE_TOOL_ID,
        versionBranch: FIXTURE_TOOL_VERSION_BRANCH,
        title: FIXTURE_TOOL_TITLE,
        subtitle: 'Forum-like applet bundled with the Moss repo.',
        description:
          'The example applet built from example/ui — used as the install target for the Playwright smoke suite.',
        icon: `${baseUrl}/tool-icon.png`,
        tags: ['e2e'],
        versions: [
          {
            version: FIXTURE_TOOL_VERSION,
            url: `${baseUrl}/example-applet.webhapp`,
            hashes,
            changelog: 'Local fixture build.',
            releasedAt: 0,
          },
        ],
      },
    ],
  };
}
