import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type MossConfig = {
  holochainVersion: string;
  lairVersion: string;
};

console.log('APP PATH: ', app.getAppPath());

const mossConfigPath = path.join(app.getAppPath(), 'moss.config.json');

const mossConfigJSON = fs.readFileSync(mossConfigPath, 'utf-8');
export const MOSS_CONFIG: MossConfig = JSON.parse(mossConfigJSON);
