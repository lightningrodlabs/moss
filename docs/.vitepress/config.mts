import { defineConfig, type DefaultTheme } from 'vitepress';
import { versions } from './versions';

// https://vitepress.dev/reference/site-config

/** The sidebar of the current docs line, with links relative to its base. */
function currentSidebar(base: string): DefaultTheme.SidebarItem[] {
  return [
    {
      text: '📚 Concepts',
      collapsed: false,
      items: [
        { text: 'Introduction', link: `${base}concepts/introduction` },
        { text: 'Tech Overview', link: `${base}concepts/overview` },
      ],
    },
    {
      text: '🛠️ Build a Weave Tool',
      collapsed: false,
      items: [
        { text: 'Choose your Path', link: `${base}build/overview` },
        { text: 'Tooling Overview', link: `${base}build/tooling-overview` },
        { text: 'Moss 0.16 for Tool Developers', link: `${base}build/moss-0.16` },
        {
          text: '🧁 Step 1: Build a Holochain app',
          items: [
            {
              text: 'Holochain Development Environment',
              link: `${base}build/holochain-development-environment`,
            },
            { text: 'Scaffold Forum Example', link: `${base}build/scaffold-forum-example` },
          ],
        },
        {
          text: '🧂 Step 2: Add Weave Sugar',
          items: [
            { text: 'Install Moss Dependencies', link: `${base}build/moss-sugar` },
            { text: 'Add Environment Check', link: `${base}build/add-environment-check` },
            { text: 'Configure CLI', link: `${base}build/configure-cli` },
          ],
        },
        {
          text: '🎙️ Audio and Speech',
          items: [{ text: 'Audio Transcription', link: `${base}build/transcription` }],
        },
        { text: 'Publishing a Tool', link: `${base}build/publishing-a-tool` },
      ],
    },
    {
      text: '📖 API Reference',
      collapsed: false,
      items: [{ text: '@theweave/api', link: `${base}api-reference/api/api.html` }],
    },
  ];
}

/** The sidebar of the frozen 0.15 docs. Its pages do not change, so neither does this list. */
function sidebar015(base: string): DefaultTheme.SidebarItem[] {
  return [
    {
      text: '📚 Concepts',
      collapsed: false,
      items: [
        { text: 'Introduction', link: `${base}concepts/introduction` },
        { text: 'Tech Overview', link: `${base}concepts/overview` },
      ],
    },
    {
      text: '🛠️ Build a Weave Tool',
      collapsed: false,
      items: [
        { text: 'Choose your Path', link: `${base}build/overview` },
        { text: 'Tooling Overview', link: `${base}build/tooling-overview` },
        {
          text: '🧁 Step 1: Build a Holochain app',
          items: [
            {
              text: 'Holochain Development Environment',
              link: `${base}build/holochain-development-environment`,
            },
            { text: 'Scaffold Forum Example', link: `${base}build/scaffold-forum-example` },
          ],
        },
        {
          text: '🧂 Step 2: Add Weave Sugar',
          items: [
            { text: 'Install Moss Dependencies', link: `${base}build/moss-sugar` },
            { text: 'Add Environment Check', link: `${base}build/add-environment-check` },
            { text: 'Configure CLI', link: `${base}build/configure-cli` },
          ],
        },
        { text: 'Publishing a Tool', link: `${base}build/publishing-a-tool` },
      ],
    },
    {
      text: '📖 API Reference',
      collapsed: false,
      items: [{ text: '@theweave/api', link: `${base}api-reference/api/api.html` }],
    },
  ];
}

const current = versions.find((v) => v.current)!;
const v015 = versions.find((v) => v.label === '0.15')!;

export default defineConfig({
  title: 'Weave/Moss',
  description: 'Build Tools for Social Fabric',
  // Internal plans and specs live under docs/superpowers for the repo's own
  // tooling; they are not part of the published site.
  srcExclude: ['superpowers/**'],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Concepts', link: '/concepts/introduction', activeMatch: '^/concepts/' },
      { text: 'API', link: '/api-reference/api/api', activeMatch: '^/api-reference/' },
    ],

    // Frozen versions come first so their base path wins over '/'.
    sidebar: {
      [v015.base]: sidebar015(v015.base),
      [current.base]: currentSidebar(current.base),
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/lightningrodlabs/moss' }],
  },
});
