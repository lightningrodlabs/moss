// Dev config that launches Moss with the Presence tool (from
// ../presence) loaded as a localhost (hot-reload) applet. Used to test
// the localModels.asr end-to-end path against the real consumer.
//
// Prereqs:
//   - Sibling checkout: ../presence with its .happ built:
//       cd ../presence && npm run build:happ
//   - Presence UI dev server reachable on $UI_PORT (the npm script in
//     this repo starts it for you).
//
// Paths here are relative to the Moss repo root (where yarn runs npm
// scripts from). If you copy this file to rename it, keep the
// ../presence references pointing at the sibling checkout.

import { defineConfig } from './cli/defineConfig';

export default defineConfig({
  toolCurations: [],
  groups: [
    {
      name: 'Tennis Club',
      networkSeed: '098rc1m-09384u-crm-29384u-cmkj',
      icon: {
        type: 'filesystem',
        path: '../presence/ui/tennis_club.png',
      },
      creatingAgent: {
        agentIdx: 1,
        agentProfile: {
          nickname: 'Gaston',
          avatar: {
            type: 'filesystem',
            path: '../presence/ui/gaston.jpeg',
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
              path: '../presence/ui/marsupilami.jpeg',
            },
          },
        },
      ],
      applets: [
        {
          name: 'presence',
          instanceName: 'presence',
          registeringAgent: 1,
          joiningAgents: [2],
        },
      ],
    },
  ],
  applets: [
    {
      name: 'presence',
      subtitle: 'video calls',
      description: 'Be present.',
      icon: {
        type: 'filesystem',
        path: '../presence/ui/icon.png',
      },
      source: {
        type: 'localhost',
        happPath: '../presence/workdir/presence.happ',
        uiPort: 8888,
      },
    },
  ],
});
