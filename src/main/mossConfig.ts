import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type MossConfig = {
  groupHapp: VersionAndSha256;
  holochain: string,
  binariesAppendix: string;
  feedbackWorkerUrl?: string;
};

type VersionAndSha256 = {
  version: string;
  sha256: string;
};

const mossConfigPath = path.join(app.getAppPath(), 'moss.config.json');
const mossConfigJSON = fs.readFileSync(mossConfigPath, 'utf-8');
export const MOSS_CONFIG: MossConfig = JSON.parse(mossConfigJSON);

const holochainChecksumsPath = path.join(app.getAppPath(), 'holochain-checksums.json');
const holochainChecksumsJSON = fs.readFileSync(holochainChecksumsPath, 'utf-8');

export const HOLOCHAIN_CHECKSUMS: any = JSON.parse(holochainChecksumsJSON);

if (MOSS_CONFIG.holochain !== HOLOCHAIN_CHECKSUMS.version) {
  throw new Error(
    `The version of Holochain in moss.config.json (${MOSS_CONFIG.holochain}) does not match the version in holochain-checksums.json (${HOLOCHAIN_CHECKSUMS.version}). Please update moss.config.json or holochain-checksums.json accordingly.`,
  );
}