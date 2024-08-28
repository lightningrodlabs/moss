import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type MossConfig = {
  holochain: VersionAndSha256;
  lair: VersionAndSha256;
  groupHapp: VersionAndSha256;
  toolsLibrary: VersionAndSha256;
  kando: VersionAndSha256;
  binariesAppendix: string;
};

type VersionAndSha256 = {
  version: string;
  sha256: string;
};

console.log('APP PATH: ', app.getAppPath());

const mossConfigPath = path.join(app.getAppPath(), 'moss.config.json');

const mossConfigJSON = fs.readFileSync(mossConfigPath, 'utf-8');
export const MOSS_CONFIG: MossConfig = JSON.parse(mossConfigJSON);
