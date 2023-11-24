import resolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import postcss from "rollup-plugin-postcss";
import postcssLit from "rollup-plugin-postcss-lit";
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json'));

export default {
  input: `src/index.ts`,
  output: [{ dir: "dist", format: "es", sourcemap: true }],
  // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash-es')
  external: [...Object.keys(pkg.dependencies), /lit/],
  watch: {
    clearScreen: false,
  },
  plugins: [
    replace({
      "this.getDocumentEl(),'pointerdown'": "this.container,'pointerdown'",
      delimiters: ["", ""],
    }),
    postcss({
      inject: false,
    }),
    postcssLit(),
    typescript(),
    resolve(),
    commonjs({}),
    {
      // trying to fix https://github.com/rollup/rollup/issues/4213
      closeBundle() {
          if (!process.env.ROLLUP_WATCH) {
            setTimeout(() => process.exit(0));
          }
      },
      name: 'force-close'
    }
  ],
};
