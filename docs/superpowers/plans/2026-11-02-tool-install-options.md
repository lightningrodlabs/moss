# Tool Install Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tool declares install options in its `weave.config.json`; Moss renders them as form fields in the install dialog, validates them, merges them into the happ's default DNA properties, and installs with the merged set.

**Architecture:** Types in `@theweave/api`, TypeBox schemas in `@theweave/moss-types`. The main process reads `weave.config.json` out of the webhapp (or from the dev UI port) inside the existing `fetch-and-validate-happ-or-webhapp` handler. A new `install-options-form` element renders the fields; a DOM-free `install-options.ts` module checks declarations, validates values, and merges. Dev mode gains per-role property overrides and finally passes `roles_settings` on both its install paths.

**Tech Stack:** TypeScript, LitElement + Shoelace, `@sinclair/typebox`, `adm-zip`, `@msgpack/msgpack`, vitest (`yarn test:unit`), `@lit/localize`.

**Spec:** `docs/superpowers/specs/2026-11-02-tool-install-options-design.md`

## Global Constraints

- Branch `feat/tool-install-options` off `main-0.7`; lands on `main-0.7`, then `main-0.7` is merged into `moss-0.16-mdns`.
- `yarn install` once after switching lineage (`package.json`/`yarn.lock` differ from `moss-0.16-mdns`).
- No `Co-Authored-By` or other attribution lines in commits (user rule).
- Strong typing: no new `any`; the IPC handler's `Promise<any>` becomes a named type.
- Every Moss-authored UI string goes through `msg()` and is translated in all eight XLIFF files (`de es fr it ja nl pt tr`), then `npx lit-localize build` in `src/renderer`.
- Code comments explain intent, never prior behaviour.
- Follow renderer practice: `sl-tooltip` for hover text, classes from `shared-styles.ts`, `aria-label` on icon-only buttons.
- `install-tool-dialog.ts` must not grow past its current 699 lines.
- Member keys are written as `encodeHashToBase64(agentPubKey)` (`uhCAk…`).

## Review Focus

- A declaration naming a `role` the happ lacks: dialog shows the error line, no form, YAML editor still usable (Task 2 `checkDeclarations`, Task 5 render).
- A `default` outside its own constraints (e.g. `number` default 5 with `max: 3`): declaration is malformed, not silently clamped (Task 2).
- `numberChoice` values round-trip as numbers, not strings, through `sl-select` (Task 5 test on `currentValues`).
- Optional non-boolean option left empty writes nothing: merged role object equals the editor base for that key (Task 2 `mergeProperties`).
- Dev-config joiner installs with the registering agent's properties, not the manifest defaults (Task 6 `installHapp` with `roles_settings` from `rolesSettingsFor`).

---

### Task 1: Types and schemas

**Files:**
- Create: `libs/api/src/tool-config.ts`
- Modify: `libs/api/src/index.ts` (add `export * from './tool-config.js';`)
- Create: `shared/types/src/tool-config.ts`
- Modify: `shared/types/src/index.ts` (add export)
- Modify: `src/main/sharedTypes.ts:41-43`, `src/renderer/src/types.ts:80-82` (delete `ToolWeaveConfig`; importers switch to `@theweave/api`)
- Test: `shared/types/src/tool-config.test.ts`

**Interfaces:**
- Produces (`@theweave/api`):
  ```ts
  export type ToolInstallOptionBase = { role: string; property: string; label: string; description?: string; required: boolean };
  export type ToolInstallOption = ToolInstallOptionBase & (
    | { kind: 'boolean'; default?: boolean }
    | { kind: 'stringChoice'; choices: { value: string; label: string }[]; default?: string | null; nullable?: boolean }
    | { kind: 'numberChoice'; choices: { value: number; label: string }[]; default?: number | null; nullable?: boolean }
    | { kind: 'string'; minLength?: number; maxLength: number; default?: string | null; nullable?: boolean }
    | { kind: 'number'; min: number; max: number; integer: boolean; default?: number | null; nullable?: boolean }
    | { kind: 'agentList'; minItems?: number; maxItems?: number; nullable?: boolean });
  export type ToolWeaveConfig = { crossGroupView?: boolean; installOptions?: ToolInstallOption[] };
  ```
- Produces (`@theweave/moss-types`): `TToolInstallOption`, `TToolWeaveConfig` (TypeBox, `additionalProperties: true` on the config object so unknown top-level keys keep passing), and
  ```ts
  export type RoleProperties = Record<string, Record<string, unknown>>; // role name -> properties
  export type HappOrWebhappInspection =
    | { type: 'happ'; sha256: string; roles: RoleProperties; weaveConfig?: unknown }
    | { type: 'webhapp'; sha256: string; happ: { sha256: string; roles: RoleProperties }; ui: { sha256: string }; weaveConfig?: unknown };
  ```

- [ ] **Step 1: `yarn install`, then write the failing test** in `shared/types/src/tool-config.test.ts`: `Value.Check(TToolWeaveConfig, vinesExample)` is true for the spec's Vines JSON; false when an option has `kind: 'colour'`; false when a `number` option lacks `max`; false when a `boolean` option carries `nullable`; true for a `number` option with `nullable: true, default: null`; true for `{ crossGroupView: true }` alone.
- [ ] **Step 2: Run** `yarn test:unit shared/types/src/tool-config.test.ts` — FAIL (module not found).
- [ ] **Step 3: Implement** the types in `libs/api/src/tool-config.ts` and the schemas plus `RoleProperties`/`HappOrWebhappInspection` in `shared/types/src/tool-config.ts`. Remove both `ToolWeaveConfig` copies and point `src/main/index.ts:84` and `src/renderer/src/electron-api.ts:43` at `@theweave/api`.
- [ ] **Step 4: Run** `yarn build:libs && yarn test:unit shared/types/src/tool-config.test.ts && yarn typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): declare tool install options in ToolWeaveConfig`.

### Task 2: Option logic (no DOM)

**Files:**
- Create: `src/renderer/src/tool-library/install-options.ts`
- Test: `src/renderer/src/tool-library/install-options.test.ts`

**Interfaces:**
- Consumes: `ToolInstallOption` (Task 1), `RoleProperties` (Task 1).
- Produces:
  ```ts
  export type InstallOptionValue = boolean | string | number | string[] | null; // null only for nullable options
  export type InstallOptionValues = Record<string, InstallOptionValue | undefined>; // keyed by optionKey; undefined = empty field
  export function optionKey(option: ToolInstallOption): string; // `${role}/${property}`
  export type DeclarationProblem = { code: 'unknown-role' | 'duplicate' | 'bad-range' | 'bad-length' | 'bad-items' | 'bad-choices' | 'bad-default' | 'required-nullable'; role: string; property: string };
  export function checkDeclarations(options: ToolInstallOption[], roleNames: string[]): DeclarationProblem | undefined;
  export function initialValues(options: ToolInstallOption[], manifestDefaults: RoleProperties): InstallOptionValues;
  export type ValueProblem = 'required' | 'wrong-type' | 'not-a-choice' | 'too-short' | 'too-long' | 'below-min' | 'above-max' | 'not-integer' | 'too-few' | 'too-many';
  export function validateValue(option: ToolInstallOption, value: InstallOptionValue | undefined): ValueProblem | undefined;
  export function mergeProperties(base: RoleProperties, options: ToolInstallOption[], values: InstallOptionValues): RoleProperties;
  ```

- [ ] **Step 1: Write failing tests** (one `describe` per function):
  - `checkDeclarations`: role not in `['rVines']` → `unknown-role`; two options with same role+property → `duplicate`; `number` `min: 5, max: 3` → `bad-range`; `string` `minLength: 4, maxLength: 2` → `bad-length`; `agentList` `minItems: 3, maxItems: 1` → `bad-items`; `stringChoice` with `choices: []` or repeated values → `bad-choices`; `number` `default: 5` with `max: 3` → `bad-default`; `string` `default: null` without `nullable` → `bad-default`; `required: true` with `nullable: true` → `required-nullable`; the Vines pair → `undefined`.
  - `initialValues`: declaration `default` wins over manifest default; manifest default `stewarded: false` used when no declaration default; manifest default of wrong type (`"yes"` for a boolean) ignored → `undefined`; `boolean` with neither → `false`; nullable `number` with neither → `null`; nullable with manifest value `null` → `null`.
  - `validateValue`: `required` + `undefined` → `'required'`; optional + `undefined` → `undefined`; `number` `integer: true` + `2.5` → `'not-integer'`; `string` of 3 chars with `maxLength: 2` → `'too-long'`; `numberChoice` + value not in choices → `'not-a-choice'`; `agentList` `maxItems: 1` + two keys → `'too-many'`; `agentList` + `[]` optional → `undefined`; boolean + `"true"` → `'wrong-type'`; nullable `number` + `null` → `undefined`; non-nullable `number` + `null` → `'wrong-type'`.
  - `mergeProperties`: base `{ rVines: { groupName: 'MyTeam', stewarded: false, stewards: [] } }`, values `{ 'rVines/stewarded': true }` → `groupName` untouched, `stewarded: true`, `stewards: []` untouched; a role absent from `base` but written by a value gets created; an unset optional value leaves the key as in base; an unset nullable option writes `null` over a base value of `5`; returns a new object (base not mutated).
- [ ] **Step 2: Run** `yarn test:unit src/renderer/src/tool-library/install-options.test.ts` — FAIL.
- [ ] **Step 3: Implement** `install-options.ts`. Order of checks in `checkDeclarations`: unknown-role, duplicate, then per-kind. `initialValues` for `agentList` is always `[]`.
- [ ] **Step 4: Run** the test — PASS.
- [ ] **Step 5: Commit** `feat(tool-library): install option checks, defaults, validation and merge`.

### Task 3: Shared `rolesSettingsFor`

**Files:**
- Modify: `shared/utils/src/utils.ts` (add function), `src/renderer/src/moss-store.ts:1355-1368` (delete private method, import from `@theweave/utils`)
- Test: `shared/utils/src/roles-settings.test.ts`

**Interfaces:**
- Produces: `export function rolesSettingsFor(properties: Record<string, Uint8Array>): RoleSettingsMap` — each role becomes `{ type: 'provisioned', value: { modifiers: { properties: decode(bytes) } } }`.

- [ ] **Step 1: Write failing test**: encode `{ stewarded: true, stewards: ['uhCAk1'] }` with `@msgpack/msgpack`, call `rolesSettingsFor({ rVines: bytes })`, assert the decoded shape above and that `{}` yields `{}`.
- [ ] **Step 2: Run** `yarn test:unit shared/utils/src/roles-settings.test.ts` — FAIL.
- [ ] **Step 3: Implement** in `shared/utils/src/utils.ts`; replace the two `this.rolesSettingsFor(applet)` call sites in `moss-store.ts` with `rolesSettingsFor(applet.properties)`.
- [ ] **Step 4: Run** `yarn build:libs && yarn test:unit && yarn typecheck:web` — PASS.
- [ ] **Step 5: Commit** `refactor(utils): share rolesSettingsFor between renderer and dev setup`.

### Task 4: Read `weave.config.json` during inspection

**Files:**
- Create: `src/main/webhappWeaveConfig.ts`
- Modify: `src/main/index.ts:2678-2712` (handler), `src/preload/admin.ts:248-249`, `src/renderer/src/electron-api.ts:319,597-599`
- Test: `src/main/webhappWeaveConfig.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/main/webhappWeaveConfig.ts — imports only zlib, @msgpack/msgpack and adm-zip, never electron, so vitest can load it
  export function readWeaveConfigFromWebhapp(webhappBytes: Uint8Array): Promise<unknown | undefined>; // gunzip + msgpack decode, find the resource whose key ends with '.zip', AdmZip(Buffer) → 'weave.config.json' → JSON.parse; undefined when absent or unparsable
  // src/main/utils.ts (electron is fine here)
  export function fetchWeaveConfigFromPort(uiPort: number): Promise<unknown | undefined>; // net.fetch http://localhost:<port>/weave.config.json with a 2000 ms AbortController, undefined on any failure
  ```
- IPC: `fetch-and-validate-happ-or-webhapp` takes `(url: string, uiPort?: number)` and returns `HappOrWebhappInspection` (Task 1). Preload and `electron-api.ts` signatures gain `uiPort?: number` and the named return type.

- [ ] **Step 1: Write failing test** for `readWeaveConfigFromWebhapp`: build a synthetic webhapp in the test (`gzipSync(encode({ manifest: {...}, resources: { 'ui.zip': zipBytes } }))` where `zipBytes` is an `AdmZip` with `weave.config.json` = `{"installOptions":[]}`) → returns that object; a zip without the file → `undefined`; a file containing `not json` → `undefined`.
- [ ] **Step 2: Run** `yarn test:unit src/main/webhappWeaveConfig.test.ts` — FAIL.
- [ ] **Step 3: Implement** `webhappWeaveConfig.ts`; retype `decompressHapp`/`decompressWebHapp` in `src/main/utils.ts` to `Promise<RoleProperties>`; in the handler set `weaveConfig` from the webhapp bytes for `webhapp` results and from `fetchWeaveConfigFromPort(uiPort)` for `happ` results when `uiPort` is given; thread `uiPort` through preload and `electron-api.ts`.
- [ ] **Step 4: Run** `yarn test:unit && yarn typecheck` — PASS (the IPC drift guard in `src/main/ipc-contract-drift.test.ts` must stay green).
- [ ] **Step 5: Commit** `feat(main): return the Tool's weave.config.json from webhapp inspection`.

### Task 5: Install dialog form

**Files:**
- Create: `src/renderer/src/tool-library/elements/install-options-form.ts`
- Modify: `src/renderer/src/tool-library/elements/install-tool-dialog.ts` (`open`, `downloadWebHapp`, `renderForm`, submit handler, `_dnaProperties` typing)
- Modify: `src/renderer/xliff/*.xlf`, regenerate `src/renderer/src/locales/generated/`
- Test: `src/renderer/src/tool-library/install-options-messages.test.ts`

**Interfaces:**
- Consumes: Task 2 functions; `HappOrWebhappInspection` (Task 1); `TToolWeaveConfig` (Task 1); `groupStore.allProfiles`.
- Produces: element `<install-options-form>` with
  ```ts
  @property({ attribute: false }) options: ToolInstallOption[];
  @property({ attribute: false }) manifestDefaults: RoleProperties;
  get currentValues(): InstallOptionValues;
  reportValidity(): boolean; // runs validateValue per option, sets setCustomValidity + reportValidity on each control, returns true when all pass
  ```
  and a DOM-free `src/renderer/src/tool-library/install-options-messages.ts` exporting `valueProblemMessage(problem: ValueProblem, option: ToolInstallOption): string` and `declarationProblemMessage(problem: DeclarationProblem): string` built with `msg()`.

- [ ] **Step 1: Write failing test** for the message helpers: `valueProblemMessage('too-many', agentListWithMaxItems2)` contains `2`; `declarationProblemMessage({ code: 'unknown-role', role: 'x', property: 'y' })` contains `x`.
- [ ] **Step 2: Run** `yarn test:unit src/renderer/src/tool-library/install-options-messages.test.ts` — FAIL.
- [ ] **Step 3: Implement the message helpers** with these source strings: `Required`, `Choose one of the listed values`, `At least ${n} characters`, `At most ${n} characters`, `At least ${n}`, `At most ${n}`, `Must be a whole number`, `Select at least ${n} members`, `Select at most ${n} members`, `Wrong type`, `Role "${role}" is not in this Tool's happ`, `Option ${role}/${property} is declared twice`, `Option ${role}/${property} has an invalid range`, `Option ${role}/${property} has invalid choices`, `Option ${role}/${property} has a default outside its constraints`, `Option ${role}/${property} cannot be both required and nullable`.
- [ ] **Step 4: Run** the test — PASS. Commit `feat(tool-library): localized install option messages`.
- [ ] **Step 5: Implement `install-options-form.ts`.** Controls: `sl-switch` (boolean), `sl-select` + `sl-option` (choices; `numberChoice` maps the selected string back to the numeric `value`), `sl-input type="text"` with `minlength`/`maxlength` (string), `sl-input type="number"` with `min`/`max`/`step` (number; `step="1"` when integer), `sl-select multiple` over `groupStore.allProfiles` with `agent-avatar` in the option prefix and the nickname as text (agentList). Each control shows `label`, uses `help-text` for `description`, and `required` when declared. Values live in `@state() private _values: InstallOptionValues` initialised from `initialValues()` whenever `options`/`manifestDefaults` change.
- [ ] **Step 6: Wire the dialog.** `_dnaProperties: RoleProperties`; new state `_installOptions: ToolInstallOption[] | undefined` and `_optionsProblem: string | undefined`. In `downloadWebHapp`, pass `uiPort` (parse the digits after `###DEVCONFIG###` in `this._tool.toolListUrl`, else undefined), keep the roles, then: if `weaveConfig` is undefined → no options; if `!Value.Check(TToolWeaveConfig, weaveConfig)` → `_optionsProblem = msg('This Tool declares install options in a format Moss does not understand.')`; else run `checkDeclarations(installOptions, Object.keys(roles))` and set `_optionsProblem` via `declarationProblemMessage` or `_installOptions`. Render, between the custom-name field and "Show Advanced": the problem as an `sl-alert variant="warning"` with the suffix `msg('You can still set DNA properties under Advanced.')`, or `<install-options-form>` under a `msg('Install options')` heading. The YAML editor's `help-text` becomes `msg('yaml. Values chosen above override these keys.')` when options exist. In the submit handler: `if (optionsForm && !optionsForm.reportValidity()) return;` then `properties = mergeProperties(baseFromEditorOrDefaults, options, optionsForm.currentValues)` where the base per role is the editor's parsed YAML when Advanced was shown, else `_dnaProperties[role]`, and only roles touched by an option or shown in the editor are included.
- [ ] **Step 7: Localize.** `cd src/renderer && npx lit-localize extract`, fill every new `<target>` in all eight XLIFF files, `npx lit-localize build`.
- [ ] **Step 8: Verify** `yarn typecheck:web && yarn test:unit` — PASS; `wc -l src/renderer/src/tool-library/elements/install-tool-dialog.ts` ≤ 699. Manual: `yarn applet-dev-example` once Task 6's example declarations exist; until then, confirm a Tool without declarations renders the dialog unchanged.
- [ ] **Step 9: Commit** `feat(tool-library): render tool-declared install options in the install dialog`.

### Task 6: Dev mode overrides and `roles_settings`

**Files:**
- Modify: `shared/types/src/defineConfig.ts:158-178` (`AppletInstallConfig.properties?: RoleProperties`)
- Create: `src/main/cli/devProperties.ts`
- Modify: `src/main/cli/devSetup.ts:348-373` (registering), `:421-428` (joining), `:612-629` (`installHapp`)
- Modify: `example/ui/weave.config.json`, `weave.dev.config.ts` (the "Example Applet Hot Reload" entry)
- Regenerate: `cli/defineConfig.js`, `cli/defineConfig.d.ts` via `tsc -p tsconfig.defineConfig.json`
- Test: `src/main/cli/devProperties.test.ts`

**Interfaces:**
- Consumes: `rolesSettingsFor` (Task 3), `decompressHapp` from `src/main/utils.ts` (returns `Promise<RoleProperties>` since Task 4).
- Produces: `export function encodeRoleOverrides(manifestDefaults: RoleProperties, overrides: RoleProperties | undefined): Record<string, Uint8Array>` — for each role in `overrides`, msgpack-encode `{ ...manifestDefaults[role], ...overrides[role] }`; roles absent from `overrides` are omitted; `undefined` overrides → `{}`.
- `installHapp(holochainManager, appId, networkSeed, pubKey, happPath, rolesSettings?: RoleSettingsMap)`.

- [ ] **Step 1: Write failing test**: defaults `{ forum: { invalid: false } }`, overrides `{ forum: { invalid: false, stewarded: true } }` → decoded `forum` equals the merged object; overrides `undefined` → `{}`; a role only in defaults is absent from the result.
- [ ] **Step 2: Run** `yarn test:unit src/main/cli/devProperties.test.ts` — FAIL.
- [ ] **Step 3: Implement** `devProperties.ts`; in `devSetup.ts` the registering path reads `await decompressHapp(fs.readFileSync(happPath))`, sets `properties: encodeRoleOverrides(defaults, appletInstallConfig.properties)` on the `Applet`, and calls `installHapp(..., rolesSettingsFor(applet.properties))`; the joining path calls `installHapp(..., rolesSettingsFor(applet.properties))` with the gossiped entry. Add `properties` to `AppletInstallConfig` with a doc comment stating values are merged over the manifest defaults per role and must be byte-identical for every member (devSetup guarantees this by storing them in the `Applet` entry).
- [ ] **Step 4: Example fixtures.** `example/ui/weave.config.json` declares seven options on role `forum`: `stewarded` (boolean, default false), `theme` (stringChoice: `light`/`dark`), `pageSize` (numberChoice: 10/25/50), `motto` (string, maxLength 40), `maxPosts` (number, min 1, max 1000, integer, required), `moderators` (agentList, maxItems 5), plus `postLimit` (number, min 1, max 1000, integer, `nullable: true`, `default: null`) to exercise the null path. `weave.dev.config.ts` sets `properties: { forum: { stewarded: true, maxPosts: 100 } }` on the example applet entry.
- [ ] **Step 5: Run** `yarn test:unit && yarn typecheck && yarn build:cli` (regenerates `cli/defineConfig.*`) — PASS. Manual: `yarn applet-dev-example`; in agent 1 open the group's "view DNA properties" for the example applet and confirm `stewarded: true` and `maxPosts: 100`; in agent 2 confirm identical properties. Then add the Tool again through the install dialog in agent 1 and confirm all six fields render, that a required empty `maxPosts` blocks submit, and that the chosen values show under "view DNA properties".
- [ ] **Step 6: Commit** `feat(cli): dev-config property overrides and roles_settings for dev-mode installs`.

### Task 7: Docs

**Files:**
- Create: `docs/build/tool-install-options.md`
- Modify: `docs/.vitepress/config.mts` (sidebar item `{ text: 'Install Options', link: '/build/tool-install-options' }` after "Configure CLI"), `docs/build/configure-cli.md` (document `properties` on applet instances), `docs/build/publishing-a-tool.md` (one sentence linking the new page)

- [ ] **Step 1: Write** `tool-install-options.md`: what `weave.config.json` is and where it ships; `crossGroupView`; `installOptions` with the common fields; one JSON example per kind; required vs optional, defaults, and `nullable` (empty leaves the manifest value unless the option is nullable, in which case it writes `null`); the overlay-merge rule and the "fixed at install, identical for every member" rule; how to test with `properties` in a dev config.
- [ ] **Step 2: Verify** `yarn docs:build` exits 0.
- [ ] **Step 3: Commit** `docs: document tool install options and dev-config property overrides`.

### Task 8: Finish

- [ ] **Step 1:** `yarn lint && yarn format && yarn typecheck && yarn test:unit` — all PASS.
- [ ] **Step 2:** Open a PR against `main-0.7`; after merge, `git merge main-0.7` into `moss-0.16-mdns`.
