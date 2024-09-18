import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Weave/Moss',
  description: 'Build Tools for Social Fabric',
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Concepts', link: '/concepts/introduction' },
      { text: 'API', link: '/api-reference/api/api' },
    ],

    sidebar: [
      {
        text: '🛠️ Build a Weave Tool',
        collapsed: false,
        items: [
          { text: 'Choose your Path', link: '/build/overview' },
          { text: 'Tooling Overview', link: '/build/tooling-overview' },
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
          // { text: 'Step 2: Add Weave sugar', link: '/markdown-examples' },
          // { text: 'Markdown Examples', link: '/markdown-examples' },
          // { text: 'Runtime API Examples', link: '/api-examples' },
        ],
      },
      {
        text: '📚 Concepts',
        collapsed: false,
        items: [{ text: 'Introduction', link: '/concepts/introduction' }],
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
