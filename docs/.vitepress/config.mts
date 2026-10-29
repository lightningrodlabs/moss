import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
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
      { text: 'Concepts', link: '/concepts/introduction' },
      { text: 'API', link: '/api-reference/api/api' },
    ],

    sidebar: [
      {
        text: '📚 Concepts',
        collapsed: false,
        items: [
          { text: 'Introduction', link: '/concepts/introduction' },
          { text: 'Tech Overview', link: '/concepts/overview' },
        ],
      },
      {
        text: '🛠️ Build a Weave Tool',
        collapsed: false,
        items: [
          { text: 'Choose your Path', link: '/build/overview' },
          { text: 'Tooling Overview', link: '/build/tooling-overview' },
          { text: 'Moss 0.16 for Tool Developers', link: '/build/moss-0.16' },
          {
            text: '🧁 Step 1: Build a Holochain app',
            items: [
              {
                text: 'Holochain Development Environment',
                link: '/build/holochain-development-environment',
              },
              {
                text: 'Scaffold Forum Example',
                link: '/build/scaffold-forum-example',
              },
            ],
          },
          {
            text: '🧂 Step 2: Add Weave Sugar',
            items: [
              {
                text: 'Install Moss Dependencies',
                link: '/build/moss-sugar',
              },
              {
                text: 'Add Environment Check',
                link: '/build/add-environment-check',
              },
              {
                text: 'Configure CLI',
                link: '/build/configure-cli',
              },
            ],
          },
          {
            text: '🎙️ Audio and Speech',
            items: [{ text: 'Audio Transcription', link: '/build/transcription' }],
          },
          { text: 'Publishing a Tool', link: '/build/publishing-a-tool' },
        ],
      },
      {
        text: '📖 API Reference',
        collapsed: false,
        items: [{ text: '@theweave/api', link: '/api-reference/api/api.html' }],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/lightningrodlabs/moss' }],
  },
});
