import fs from 'fs';

export type MossConfig = {
  holochainVersion: string;
  lairVersion: string;
};

const mossConfigJSON = fs.readFileSync('moss.config.json', 'utf-8');
export const MOSS_CONFIG: MossConfig = JSON.parse(mossConfigJSON);
