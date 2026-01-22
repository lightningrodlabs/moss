import * as path from 'path';
import * as fs from 'fs';
import {downloadFile} from "./fetch-fns.mjs";

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

downloadFile(
  `https://github.com/lightningrodlabs/moss/releases/download/group-happ-v${mossConfig.groupHapp.version}/group.happ`,
  path.join('resources', 'default-apps', 'group.happ'),
  mossConfig.groupHapp.sha256,
);
