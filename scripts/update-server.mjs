import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 5555;

// Serve update files
app.use('/updates', express.static(path.join(__dirname, '../dist')));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  next();
});

// Logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.listen(PORT, () => {
  console.log(`✓ Update server running at http://localhost:${PORT}`);
  console.log(`✓ Serving from: ${path.join(__dirname, '../dist')}`);
  console.log('\nExpected files:');
  console.log('  - latest-mac.yml (or latest.yml for Windows)');
  console.log('  - Moss-{version}-{arch}.dmg (or .exe/.AppImage)');
});
