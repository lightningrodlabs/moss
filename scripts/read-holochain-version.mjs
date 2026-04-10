import fs from 'fs';

const mossConfigJSON = fs.readFileSync('moss.config.json');
const mossConfig = JSON.parse(mossConfigJSON);

console.log(mossConfig.holochain);
