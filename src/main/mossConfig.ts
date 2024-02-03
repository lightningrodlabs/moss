import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type MossConfig = {
  holochainVersion: string;
  lairVersion: string;
};

const mossConfigPath = path.join(app.getAppPath(), 'moss.config.json');

const mossConfigJSON = fs.readFileSync(mossConfigPath, 'utf-8');
export const MOSS_CONFIG: MossConfig = JSON.parse(mossConfigJSON);
