import * as fs from 'fs';
import https from 'https';
import * as path from 'path';
import { exec } from 'child_process';

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

const targetDir = path.join('resources', 'default-apps');

const toolsLibraryUrl = `https://github.com/lightningrodlabs/tools-library/releases/download/v${mossConfig.toolsLibraryVersion}/tools-library.happ`;
const kandoUrl = `https://github.com/holochain-apps/kando/releases/download/v${mossConfig.kandoVersion}/kando.webhapp`;

function downloadFile(url, targetDir, fileName) {
  exec(`curl -f -L --output ${targetDir}/${fileName} ${url}`, (error, stdout, stderr) => {
    console.log(stdout);
    console.log(stderr);
    if (error !== null) {
      console.log('exec error: ' + error);
    }
  });
}

downloadFile(toolsLibraryUrl, targetDir, 'tools-library.happ');
downloadFile(kandoUrl, targetDir, 'kando.happ');
