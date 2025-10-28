import { defineConfig } from './cli/defineConfig';

export default defineConfig({
  toolCurations: [
    {
      url: 'https://raw.githubusercontent.com/lightningrodlabs/weave-tool-curation/refs/heads/test-0.14/0.14/lists/curations-0.14.json',
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
          name: 'notebooks',
          instanceName: 'notebooks',
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
      name: 'notebooks',
      subtitle: 'Collaborative note taking',
      description: 'Real-time notetaking based on syn',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'https',
        url: 'https://github.com/lightningrodlabs/notebooks/releases/download/v0.5.0-rc.0/notebooks.webhapp',
      },
    },
  ],
});
