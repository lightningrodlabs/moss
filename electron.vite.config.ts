import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@holochain/client'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          admin: resolve(__dirname, 'src/preload/admin.ts'),
          happs: resolve(__dirname, 'src/preload/happs.ts'),
          splashscreen: resolve(__dirname, 'src/preload/splashscreen.ts'),
        },
      },
    },
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          admin: resolve(__dirname, 'src/renderer/index.html'),
          splashscreen: resolve(__dirname, 'src/renderer/splashscreen.html'),
        },
      },
    },
  },
});
