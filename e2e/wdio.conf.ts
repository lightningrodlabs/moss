import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import type { Options } from "@wdio/types";

// keep track of the `tauri-driver` child process
let tauriDriver;

export const config: Options.Testrunner = {
  specs: ["./tests/**/*.ts"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: "../target/release/we",
      },
    } as any,
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },
  autoCompileOpts: {
    autoCompile: true,
    // see https://github.com/TypeStrong/ts-node#cli-and-programmatic-options
    // for all available options
    tsNodeOpts: {
      transpileOnly: true,
      project: "./tsconfig.json",
    },
  },

  // ensure we are running `tauri-driver` before the session starts so that we can proxy the webdriver requests
  beforeSession: () =>
    (tauriDriver = spawn(
      path.resolve(os.homedir(), ".cargo", "bin", "tauri-driver"),
      [],
      { stdio: [null, process.stdout, process.stderr] }
    )),

  // clean up the `tauri-driver` process we spawned at the start of the session
  afterSession: () => tauriDriver.kill(),
};
