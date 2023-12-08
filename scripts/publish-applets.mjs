import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { AdminWebsocket, AppAgentWebsocket } from '@holochain/client';
import yaml from 'js-yaml';

const WE_LOGO_PATH = `${process.cwd()}/logo.svg`;
const TESTING_APPLETS_PATH = `${process.cwd()}/testing-applets`;

function getAppletsPaths() {
  return fs.readdirSync(TESTING_APPLETS_PATH).filter((p) => p.endsWith('.webhapp'));
}

async function publishApplets() {
  const adminWs = await AdminWebsocket.connect(
    new URL(`ws://127.0.0.1:${process.env.ADMIN_PORT}`),
    100000,
  );

  const apps = await adminWs.listApps({});

  const appstoreAppId = apps.find((app) =>
    app.installed_app_id.includes('AppstoreLight'),
  ).installed_app_id;

  const appPorts = await adminWs.listAppInterfaces();

  const appstoreClient = await AppAgentWebsocket.connect(
    new URL(`ws://127.0.0.1:${appPorts[0]}`),
    appstoreAppId,
    100000,
  );
  const appstoreCells = await appstoreClient.appInfo();
  for (const [role_name, [cell]] of Object.entries(appstoreCells.cell_info)) {
    await adminWs.authorizeSigningCredentials(cell['provisioned'].cell_id, {
      All: null,
    });
  }

  const publisher = await appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'create_publisher',
    payload: {
      name: 'applet-developer',
      location: {
        country: 'in',
        region: 'frontof',
        city: 'myscreen',
      },
      website: {
        url: 'https://duckduckgo.com',
      },
      icon_src: 'unnecessary',
    },
  });

  const allAppsOutput = await appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'get_all_apps',
    payload: null,
  });
  const appletsPaths = getAppletsPaths();
  for (const appletPath of appletsPaths) {
    console.log('Found applet at path: ', appletPath);
    const appletName = appletPath.split('.')[0];
    console.log('Derived applet name: ', appletName);
    if (allAppsOutput.payload.find((app) => app.content.title === appletName)) {
      console.log(`Applet ${appletName} already published`);
      continue;
    }

    const source = JSON.stringify({
      type: 'https',
      url: `file://${path.join(TESTING_APPLETS_PATH, appletPath)}`,
    });

    await appstoreClient.callZome({
      role_name: 'appstore',
      zome_name: 'appstore_api',
      fn_name: 'create_app',
      payload: {
        title: appletName,
        subtitle: '--development--',
        description: '--development--',
        icon_src: 'unused',
        publisher: publisher.payload.id,
        source,
        hashes: 'undefined',
      },
    });

    console.log('Published applet: ', appletName);
  }
}

async function publishAppletsRetry() {
  try {
    await publishApplets();
  } catch (e) {
    if (e.toString().includes('could not connect to holochain conductor')) {
      console.log(
        "Couldn't publish applets yet because the conductor is still setting up, have you entered your password and enabled the developer mode? Retrying again in a few seconds...",
      );
    } else if (e.toString().includes('crypto.getRandomValues is not a function')) {
      console.log('Failed to publish applets: Error: ', e);
      console.log(
        "\n\nMake sure to use a recent enough version of node (>18). Check your node version with 'node --version'.",
      );
    } else if (
      e
        .toString()
        .includes("TypeError: Cannot read properties of undefined (reading 'installed_app_id')")
    ) {
      console.log('Failed to publish applets: Error: ', e);
      console.log("\n\nYou probably haven't installed the DevHub yet.");
    } else if (e.toString().includes('syntax error near unexpected token')) {
      console.log(
        'Check the name of the webhapp file. There might be unexpected syntax in the name.',
      );
    } else if (e.toString().includes('testing-applets')) {
      console.log("You probably haven't add webhapp`s file to testing-applets directory");
    } else if (e.toString().includes('hc: command not found')) {
      console.log(
        'Remember to run this script from within a nix-shell. So the hc command will be available.',
      );
    } else {
      console.log('Failed to publish applets. Error: ', e);
    }
    setTimeout(async () => {
      await publishAppletsRetry();
    }, 15000);
  }
}
publishAppletsRetry();

// setInterval(async () => {
//   try {
//     await publishApplets();
//   } catch (e) {
//     if (e.toString().includes("could not connect to holochain conductor")) {
//       console.log(
//         "Couldn't publish applets yet because the conductor is still setting up, have you entered your password and enabled the developer mode? Retrying again in a few seconds..."
//       );
//     } else if (e.toString().includes("crypto.getRandomValues is not a function")) {
//       console.log("Failed to publish applets: Error: ", e);
//       console.log("\n\nMake sure to use a recent enough version of node (>18). Check your node version with 'node --version'.");
//     } else if (e.toString().includes("TypeError: Cannot read properties of undefined (reading 'installed_app_id')")) {
//       console.log("Failed to publish applets: Error: ", e);
//       console.log("\n\nYou probably haven't installed the DevHub yet.");
//     } else {
//       console.log("Failed to publish applets. Error: ", e);
//     }

//     console.log("Attempting applet publishing again in 15 seconds.")
//   }
// }, 10000);
