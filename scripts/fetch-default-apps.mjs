import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import crypto from 'crypto';

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

const targetDir = path.join('resources', 'default-apps');

const toolsLibraryUrl = `https://github.com/lightningrodlabs/tools-library/releases/download/v${mossConfig.toolsLibrary.version}/tools-library.happ`;
const kandoUrl = `https://github.com/holochain-apps/kando/releases/download/v${mossConfig.kando.version}/kando.webhapp`;

function downloadFile(url, targetDir, fileName, expectedSha256Hex) {
  const filePath = path.join(targetDir, fileName);
  exec(`curl -f -L --output ${filePath} ${url}`, (error, stdout, stderr) => {
    console.log(stdout);
    console.log(stderr);
    if (error !== null) {
      console.log('exec error: ' + error);
      throw new Error('Failed to fetch resource.');
    }
  });

  const fileBytes = fs.readFileSync(filePath);
  const hasher = crypto.createHash('sha256');
  hasher.update(fileBytes);
  const sha256Hex = hasher.digest('hex');
  if (sha256Hex !== expectedSha256Hex)
    throw new Error(
      `sha256 does not match the expected sha256. Got ${sha256Hex} but expected ${expectedSha256Hex}`,
    );

  console.log('Download successful. sha256 of file (hex): ', sha256Hex);
}

console.log('Fetching tool library from ', toolsLibraryUrl);
downloadFile(toolsLibraryUrl, targetDir, 'tools-library.happ', mossConfig.toolsLibrary.sha256);
console.log('Fetching kando from ', kandoUrl);
downloadFile(kandoUrl, targetDir, 'kando.webhapp', mossConfig.kando.sha256);
