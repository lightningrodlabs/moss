#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let electronBinary;
let pathStr = '../node_modules/.bin/electron';
// recursively look for electron binary in node_modules folder
for (let i = 0; i < 7; i++) {
  const maybeElectronBinary = path.resolve(__dirname, pathStr);
  if (fs.existsSync(maybeElectronBinary)) {
    electronBinary = maybeElectronBinary;
    break;
  } else {
    pathStr = '../' + pathStr;
  }
}

if (!electronBinary) {
  throw new Error('Failed to locate electron binary. __dirname: ', __dirname);
}

const child = spawn(electronBinary, [path.resolve(__dirname, 'main/index.js'), ...process.argv], {
  stdio: 'inherit',
});

child.on('error', (err) => console.error('[electron]: ERROR: ', err));

// Handle child process exit
child.on('exit', (code, _signal) => {
  process.exit(code);
});
