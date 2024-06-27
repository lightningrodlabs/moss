import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@holochain/client', '@holochain-open-dev/utils', 'nanoid', 'mime'],
      }),
    ],
    build: {
      watch: {
        exclude: ['**/.cargo/**', '.cargo'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          admin: resolve(__dirname, 'src/preload/admin.ts'),
          splashscreen: resolve(__dirname, 'src/preload/splashscreen.ts'),
          selectmediasource: resolve(__dirname, 'src/preload/selectmediasource.ts'),
          walwindow: resolve(__dirname, 'src/preload/walwindow.ts'),
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
          selectmediasource: resolve(__dirname, 'src/renderer/selectmediasource.html'),
          walwindow: resolve(__dirname, 'src/renderer/walwindow.html'),
        },
      },
    },
    plugins: [
      viteStaticCopy({
        targets: [
          {
            src: resolve(__dirname, '../../node_modules/@shoelace-style/shoelace/dist/assets'),
            dest: 'shoelace',
          },
          {
            src: resolve(__dirname, 'we_logo.png'),
            dest: 'dist/assets',
          },
        ],
      }),
    ],
  },
});
