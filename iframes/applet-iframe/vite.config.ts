// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      // why: this bundle is fetched and run via eval() by @theweave/api's
      // initializeHotReload() for localhost dev applets. eval() executes code
      // as a classic script, where module-only syntax (`import.meta`, emitted
      // by libsodium's WASM loader) is a SyntaxError. IIFE output is
      // classic-script-safe, so it works for both the eval() dev path and the
      // production `<script type="module">` injection.
      formats: ['iife'],
      // Could also be a dictionary or array of multiple entry points
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'index',
      // keep the .mjs filename the main process reads (customSchemes.ts, index.ts)
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: ['/index.js'],
    },
    outDir: '../../out/applet-iframe',
  },
});
