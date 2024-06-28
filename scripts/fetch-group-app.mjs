import * as fs from 'fs';
import https from 'https';
import * as path from 'path';
import { exec } from 'child_process';

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

const targetDir = path.join('resources', 'default-apps');

const groupHappUrl = `https://github.com/lightningrodlabs/we/releases/download/group-happ-v${mossConfig.groupHappVersion}/group.happ`;

function downloadFile(url, targetDir, fileName) {
  exec(`curl -f -L --output ${targetDir}/${fileName} ${url}`, (error, stdout, stderr) => {
    console.log(stdout);
    console.log(stderr);
    if (error !== null) {
      console.log('exec error: ' + error);
    }
  });
}

console.log('Fetching group happ from ', groupHappUrl);
downloadFile(groupHappUrl, targetDir, 'group.happ');
