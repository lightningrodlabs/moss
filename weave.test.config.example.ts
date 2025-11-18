import { defineConfig } from './cli/defineConfig';

export default defineConfig({
  toolCurations: [
    {
      url: 'https://raw.githubusercontent.com/lightningrodlabs/weave-tool-curation/refs/heads/test-0.15/0.15/lists/curations-0.15.json',
      useLists: ['default'],
    },
  ],
  groups: [
    {
      name: 'Tennis Club',
      networkSeed: '098rc1m-09384u-crm-29384u-cmkj',
      icon: {
        type: 'filesystem',
        path: './example/ui/tennis_club.png',
      },
      creatingAgent: {
        agentIdx: 1,
        agentProfile: {
          nickname: 'Gaston',
          avatar: {
            type: 'filesystem',
            path: './example/ui/gaston.jpeg',
          },
        },
      },
      joiningAgents: [
        {
          agentIdx: 2,
          agentProfile: {
            nickname: 'Marsupilami',
            avatar: {
              type: 'filesystem',
              path: './example/ui/marsupilami.jpeg',
            },
          },
        },
      ],
      applets: [
        {
          name: 'Example Applet',
          instanceName: 'Example Applet',
          registeringAgent: 1,
          joiningAgents: [2],
        },
        {
          name: 'Example Applet Hot Reload',
          instanceName: 'Example Applet Hot Reload',
          registeringAgent: 1,
          joiningAgents: [2],
        },
        {
          name: 'vines',
          instanceName: 'vines',
          registeringAgent: 1,
          joiningAgents: [2],
        },
      ],
    },
  ],
  applets: [
    {
      name: 'Example Applet',
      subtitle: 'Just an Example',
      description: 'Just an example applet to show the various affordances of Moss',
      icon: {
        type: 'filesystem',
        path: './example/ui/icon.png',
      },
      source: {
        type: 'filesystem',
        path: './example/workdir/example-applet.webhapp',
      },
    },
    {
      name: 'Example Applet Hot Reload',
      subtitle: 'Just an Example',
      description: 'Just an example applet to show the various affordances of Moss',
      icon: {
        type: 'filesystem',
        path: './example/ui/icon.png',
      },
      source: {
        type: 'localhost',
        happPath: './example/workdir/example-applet.happ',
        uiPort: 8888,
      },
    },
    {
      name: 'vines',
      subtitle: 'Chat',
      description: 'Real-time chat',
      icon: {
        type: 'https',
        url: 'https://github.com/lightningrodlabs/vines/releases/download/we-applet-rc/icon.png',
      },
      source: {
        type: 'https',
        url: 'https://github.com/lightningrodlabs/vines/releases/download/we-applet-rc/vines-we_applet-1.19.0.webhapp',
      },
    },
  ],
});
