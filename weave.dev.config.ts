import { defineConfig } from '@theweave/cli';

export default defineConfig({
  groups: [
    {
      name: 'Lightningrod Labs',
      networkSeed: '098rc1m-09384u-crm-29384u-cmkj',
      icon: {
        type: 'filesystem',
        path: '/home/matthias/Pictures/lightningrodlabs_logo.png',
      },
      creatingAgent: {
        agentIdx: 1,
        agentProfile: {
          nickname: 'matthme',
          avatar: {
            type: 'filesystem',
            path: '/home/matthias/Pictures/GaAs.png',
          },
        },
      },
      joiningAgents: [
        {
          agentIdx: 2,
          agentProfile: {
            nickname: 'Gaston',
            avatar: {
              type: 'filesystem',
              path: '/home/matthias/Pictures/gaston.jpeg',
            },
          },
        },
        {
          agentIdx: 3,
          agentProfile: {
            nickname: 'Marsupilami',
            avatar: {
              type: 'filesystem',
              path: '/home/matthias/code/holochain/matthme/presence/ui/marsupilami.jpeg',
            },
          },
        },
      ],
      applets: [
        {
          name: 'Example Applet Hot Reload',
          instanceName: 'Example (HR)',
          registeringAgent: 1,
          joiningAgents: [2],
        },
        {
          name: 'Presence',
          instanceName: 'Presence',
          registeringAgent: 1,
          joiningAgents: [],
        },
        // {
        //   name: 'KanDo (localhost)',
        //   instanceName: 'KanDo',
        //   registeringAgent: 1,
        //   joiningAgents: [2],
        // },
        // {
        //   name: 'Presence webhapp',
        //   instanceName: 'Presence',
        //   registeringAgent: 1,
        //   joiningAgents: [2],
        // },
        // {
        //   name: 'Acorn (web)',
        //   instanceName: 'acorn',
        //   registeringAgent: 1,
        //   joiningAgents: [2],
        // },
        // {
        //   name: 'ZipTest',
        //   instanceName: 'ZipTest',
        //   registeringAgent: 1,
        //   joiningAgents: [2],
        // },
      ],
    },
  ],
  applets: [
    // {
    //   name: 'Acorn (localhost)',
    //   subtitle: 'Acorn',
    //   description: 'Project management',
    //   icon: {
    //     type: 'filesystem',
    //     path: '/home/matthias/Pictures/lightningrodlabs_logo.png',
    //   },
    //   source: {
    //     type: 'localhost',
    //     happPath:
    //       '/home/matthias/code/holochain/lightningrodlabs/acorn/electron/binaries/projects.happ',
    //     uiPort: 8081,
    //   },
    // },
    // {
    //   name: 'Acorn (filesystem)',
    //   subtitle: 'Acorn',
    //   description: 'Project management',
    //   icon: {
    //     type: 'filesystem',
    //     path: '/home/matthias/Pictures/lightningrodlabs_logo.png',
    //   },
    //   source: {
    //     type: 'filesystem',
    //     path: '/home/matthias/code/holochain/lightningrodlabs/acorn/we-applet/acorn.webhapp',
    //   },
    // },
    // {
    //   name: 'Acorn (web)',
    //   subtitle: 'Acorn',
    //   description: 'Project management',
    //   icon: {
    //     type: 'filesystem',
    //     path: '/home/matthias/Pictures/lightningrodlabs_logo.png',
    //   },
    //   source: {
    //     type: 'https',
    //     url: 'https://github.com/lightningrodlabs/acorn/releases/download/v11.0.2-alpha/acorn.webhapp',
    //   },
    // },
    // {
    //   name: 'ZipTest',
    //   subtitle: 'Ephemeral messages and gossip testing',
    //   description: '...',
    //   icon: {
    //     type: 'filesystem',
    //     path: '/home/matthias/Downloads/ziptest_icon.png',
    //   },
    //   source: {
    //     type: 'https',
    //     url: 'https://github.com/holochain-apps/ziptest/releases/download/v0.0.6/ziptest.webhapp',
    //   },
    // },
    {
      name: 'Peer Status Test',
      subtitle: 'Testing the peer status zome and UI',
      description: 'Peer-status zome',
      icon: {
        type: 'filesystem',
        path: '/home/matthias/Pictures/lightningrodlabs_logo.png',
      },
      source: {
        type: 'localhost',
        happPath:
          '/home/matthias/code/holochain/open-dev/peer-status/workdir/happ/status-test.happ',
        uiPort: 8886,
      },
    },
    {
      name: 'Example Applet',
      subtitle: 'Just an Example',
      description: 'Just an example applet to show the various affordances of We',
      icon: {
        type: 'filesystem',
        path: '/home/matthias/Pictures/hc_stress_test_icon.png',
      },
      source: {
        type: 'filesystem',
        path: '/home/matthias/code/holochain/lightningrodlabs/moss/example/workdir/example-applet.webhapp',
      },
    },
    {
      name: 'Example Applet Hot Reload',
      subtitle: 'Just an Example',
      description: 'Just an example applet to show the various affordances of We',
      icon: {
        type: 'filesystem',
        path: '/home/matthias/Pictures/burner_group_chat_icon.png',
      },
      source: {
        type: 'localhost',
        happPath: './example/workdir/example-applet.happ',
        uiPort: 8888,
      },
    },
    {
      name: 'Pictogram',
      subtitle: 'images with stories',
      description: 'Pictogram',
      icon: {
        type: 'filesystem',
        path: '/home/matthias/Pictures/hc_stress_test_icon.png',
      },
      source: {
        type: 'filesystem',
        path: '/home/matthias/code/holochain/others/hc-pictogram/workdir/pictorgram.webhapp',
      },
    },
    {
      name: 'Presence',
      subtitle: 'Video Calling on Holochain',
      description: 'Video Calling on Holochain.',
      icon: {
        type: 'filesystem',
        path: '/home/matthias/code/holochain/matthme/presence/ui/icon.png',
      },
      source: {
        type: 'localhost',
        happPath: '/home/matthias/code/holochain/matthme/presence/workdir/presence.happ',
        uiPort: 8885,
      },
    },
    {
      name: 'Presence webhapp',
      subtitle: 'Video Calling on Holochain',
      description: 'Video Calling on Holochain.',
      icon: {
        type: 'filesystem',
        path: '/home/matthias/code/holochain/matthme/presence/ui/icon.png',
      },
      source: {
        type: 'filesystem',
        path: '/home/matthias/code/holochain/matthme/presence/workdir/presence.webhapp',
      },
    },
    {
      name: 'notebooks',
      subtitle: 'Real-time collaborative note-taking',
      description: 'Real-time collaborative note-taking based on syn.',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'localhost',
        happPath: '/home/matthias/code/holochain/lightningrodlabs/notebooks/workdir/notebooks.happ',
        uiPort: 8887,
      },
    },
    {
      name: 'notebooks LOCAL',
      subtitle: 'Real-time collaborative note-taking',
      description: 'Real-time collaborative note-taking based on syn.',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'filesystem',
        path: '/home/matthias/code/holochain/lightningrodlabs/notebooks/workdir/notebooks.webhapp',
      },
    },
    {
      name: 'notebooks from github',
      subtitle: 'Real-time collaborative note-taking',
      description: 'Real-time collaborative note-taking based on syn.',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'https',
        url: 'https://github.com/lightningrodlabs/notebooks/releases/download/v0.0.9/notebooks.webhapp',
      },
    },
    {
      name: 'KanDo (localhost)',
      subtitle: 'KanBan board on Holochain',
      description: 'KanBan board',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'localhost',
        happPath: '/home/matthias/code/holochain/holochain-apps/kando/workdir/kando.happ',
        uiPort: 1420,
      },
    },
    {
      name: 'KanDo',
      subtitle: 'KanBan board on Holochain',
      description: 'KanBan board',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'https',
        url: 'https://github.com/holochain-apps/kando/releases/download/v0.9.3/kando.webhapp',
      },
    },
    {
      name: 'TalkingStickies',
      subtitle: 'TalkingStickies',
      description: 'TalkingStickies',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'https',
        url: 'https://github.com/holochain-apps/talking-stickies/releases/download/v0.7.1/talking-stickies.webhapp',
      },
    },
    {
      name: 'Gamez',
      subtitle: 'Up for Gamez?',
      description: 'Board games of any kind.',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'https',
        url: 'https://github.com/holochain-apps/gamez/releases/download/v0.3.14/gamez.webhapp',
      },
    },
    {
      name: 'Threads',
      subtitle: 'Threading',
      description: 'Text messaging',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'https',
        url: 'https://github.com/lightningrodlabs/threads/releases/download/we-applet-rc/threads-we_applet-notifs.webhapp',
      },
    },
  ],
});
