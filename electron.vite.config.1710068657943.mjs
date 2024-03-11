// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";
var __electron_vite_injected_dirname = "/home/matthias/code/holochain/lightningrodlabs/we";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@holochain/client", "@holochain-open-dev/utils", "nanoid", "mime"]
      })
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          admin: resolve(__electron_vite_injected_dirname, "src/preload/admin.ts"),
          splashscreen: resolve(__electron_vite_injected_dirname, "src/preload/splashscreen.ts"),
          selectmediasource: resolve(__electron_vite_injected_dirname, "src/preload/selectmediasource.ts")
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          admin: resolve(__electron_vite_injected_dirname, "src/renderer/index.html"),
          splashscreen: resolve(__electron_vite_injected_dirname, "src/renderer/splashscreen.html"),
          selectmediasource: resolve(__electron_vite_injected_dirname, "src/renderer/selectmediasource.html")
        }
      }
    },
    plugins: [
      viteStaticCopy({
        targets: [
          {
            src: resolve(__electron_vite_injected_dirname, "../../node_modules/@shoelace-style/shoelace/dist/assets"),
            dest: "shoelace"
          },
          {
            src: resolve(__electron_vite_injected_dirname, "we_logo.png"),
            dest: "dist/assets"
          }
        ]
      })
    ]
  }
});
export {
  electron_vite_config_default as default
};
