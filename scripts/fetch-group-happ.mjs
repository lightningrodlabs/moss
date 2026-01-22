import * as path from 'path';
import * as fs from 'fs';
import {downloadFile} from "./fetch-fns.mjs";

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

const targetDir = path.join('resources', 'default-apps');
fs.mkdirSync(targetDir, {recursive: true});

downloadFile(
  `https://github.com/lightningrodlabs/moss/releases/download/group-happ-v${mossConfig.groupHapp.version}/group.happ`,
  path.join(targetDir, 'group.happ'),
  mossConfig.groupHapp.sha256,
);
