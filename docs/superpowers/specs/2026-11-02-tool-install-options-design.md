# Design: Tool-declared install options

Written for a builder working in this repository on branch
`feat/tool-install-options` (off `main-0.7`). It turns the Vines brief
(`vines/docs/superpowers/specs/2026-11-01-moss-tool-install-options-brief.md`,
branch `stewarded-instances`) into decisions a plan can be written from, and
records where the brief was wrong or silent.

## Intent

A Tool declares, in its own `weave.config.json`, a short list of install
options. When someone adds the Tool to a group, the install dialog renders
those options as ordinary form fields, validates the values, merges them into
the happ manifest's default DNA properties for the named role, and installs
with the merged set. Joiners keep getting the installer's exact properties
through the `Applet` entry, so every member lands on the same DNA.

The first consumer is Vines' stewarded mode: a `stewarded` boolean and a
`stewards` list of group members in role `rVines`.

## Goals

- A Tool with declarations gets a form above "Show Advanced"; one without is
  unchanged.
- Six option kinds: boolean, string choice, number choice, free string with
  length bounds, free number with range bounds, list of group members.
- Required options block install until valid. Every value is validated
  against its declaration before install.
- A malformed declaration is shown to the installer as an error and the Tool
  stays installable through the YAML editor.
- Dev mode (`weave --dev-config`) can set per-role properties so Tool authors
  can test what their options write.
- Tool docs in `docs/build/` explain the format.

## Non-goals

- Editing values after install.
- Showing chosen values by label in the applet settings card (the brief's
  "nice extra"). Skipped; "view DNA properties" already shows the raw result.
- Hosts other than Moss.
- Vines' own declarations. They follow once this lands.
- Validating dev-config property overrides against the declaration.

## Anti-goals

- Installer and joiner ending up on different DNA hashes.
- The form and the YAML editor silently disagreeing about what gets sent.
- A Tool without declarations behaving any differently from today.
- Growing `install-tool-dialog.ts` (already 699 lines) by another few hundred.

## Assessment of the brief

Findings from reading the code paths the brief names. Each one is either a
confirmed assumption, a gap, or a correction.

1. **Agent key: confirmed.** Production installs every app, groups and Tools
   alike, with one global agent key: `install-applet-bundle` in
   `src/main/index.ts` takes `globalPubKeyFromListAppsResponse(apps)` and
   passes it as `agent_key`. Dev mode uses `groupWebsocket.myPubKey`. The key a
   member is shown under in the group is the key the Tool's cell uses, so a
   picker over group members is right.

2. **Dev mode cannot name other agents.** `devSetup.ts` has the creating agent
   register applets before any joining agent exists (joiners wait `syncTime`
   and then look for unjoined applets). So a dev config can never resolve
   another agent's key for a member-list option. Dev config therefore sets raw
   per-role property values, not option values. For Vines this is enough: the
   installer counts as a steward regardless, so `stewards: []` plus
   `stewarded: true` tests the stewarded path.

3. **Dev mode joiners ignore properties today.** `installHapp` in `devSetup.ts`
   never passes `roles_settings`, for the registering agent or for joiners.
   Once the registering agent installs with non-default properties, dev-config
   joiners would silently land on a different DNA. The brief says "nothing
   downstream should need to change"; for dev mode that is wrong. Both dev
   paths must derive `roles_settings` from the `Applet` entry the same way the
   renderer does.

4. **Declaration source for localhost Tools.** Reading `weave.config.json` out
   of the webhapp's UI zip covers published Tools and `filesystem` dev Tools.
   A `localhost` dev Tool ships a bare `.happ` and serves its UI from a port,
   so there is no zip; the declaration must be fetched from
   `http://localhost:<port>/weave.config.json`, as `index.ts` already does for
   installed apps. The install dialog knows the port: dev-config Tools carry it
   in `toolListUrl` after the `###DEVCONFIG###` marker.

5. **Optional boolean has no "unset".** The brief says optional options may be
   left unset and that optional booleans have a default. A switch is always on
   or off. Resolution below: booleans always write a value.

6. **Required with a manifest default.** A required option whose key already
   has a manifest default would always be satisfiable without the user
   touching it. Resolution: the field is pre-filled from the manifest default,
   and "required" only means the field must hold a valid value at submit.

7. **Type placement.** `shared/types` (`@theweave/moss-types`) depends on
   `libs/api` (`@theweave/api`), not the other way round. So the TypeScript
   declaration type goes in `@theweave/api` (what Tool authors install) and the
   TypeBox runtime schema goes in `@theweave/moss-types` next to
   `TDistributionInfo`. Both `src/main` and `src/renderer` already import both
   packages, so the two hand-copied `ToolWeaveConfig` types can go.

8. **Localization.** Every Moss-authored string in the new form goes through
   `msg()` and all eight XLIFF files. Author-provided labels and descriptions
   from `weave.config.json` are shown as-is.

9. **Form-vs-editor rule.** Chosen below: the YAML editor is the base, the
   form's values overlay it at submit.

10. **Branching.** `moss-0.16-mdns` contains every commit of `main-0.7` and the
    history shows `main-0.7` being merged into it repeatedly. Every file this
    work touches is identical on both branches except `group-store.ts` and
    `moss-store.ts`, whose install functions are unchanged between them. So:
    branch off `main-0.7`, land there, merge `main-0.7` into `moss-0.16-mdns`.
    Switching this checkout to the `main-0.7` lineage changes `package.json`
    and `yarn.lock`, so `yarn install` is needed before typecheck or tests run.

## Declaration format

Lives in the Tool's `weave.config.json`, beside `crossGroupView`:

```json
{
  "crossGroupView": true,
  "installOptions": [
    {
      "role": "rVines",
      "property": "stewarded",
      "kind": "boolean",
      "label": "Stewarded",
      "description": "Only stewards create categories and channels.",
      "required": false,
      "default": false
    },
    {
      "role": "rVines",
      "property": "stewards",
      "kind": "agentList",
      "label": "Stewards",
      "description": "Members who may shape the structure. You always count.",
      "required": false,
      "maxItems": 50
    }
  ]
}
```

Common fields on every option: `role`, `property`, `kind`, `label`,
`description?`, `required` (boolean, explicit). `role` plus `property` is
the option's identity; two options may not share one. Every kind except
`boolean` also accepts `nullable?: boolean` (see "Null as a value" below).

Per kind:

| kind | extra fields | writes |
|---|---|---|
| `boolean` | `default?: boolean` | boolean |
| `stringChoice` | `choices: {value: string, label: string}[]`, `default?: string` | string |
| `numberChoice` | `choices: {value: number, label: string}[]`, `default?: number` | number |
| `string` | `minLength?: number` (0), `maxLength: number`, `default?: string` | string |
| `number` | `min: number`, `max: number`, `integer: boolean`, `default?: number` | number |
| `agentList` | `minItems?: number`, `maxItems?: number` | string[] of `u`-prefixed base64 agent keys |

A declaration is malformed when any of these fail: TypeBox schema; a `role`
not in the happ manifest; duplicate `role`+`property`; `min > max`;
`minLength > maxLength`; `minItems > maxItems`; empty `choices` or repeated
`value`s; a `default` outside its own constraints; `default: null` without
`nullable`; `required` together with `nullable`. The dialog shows one error
line naming the reason and renders no form; the YAML editor still works.

TypeScript: `ToolInstallOption` (discriminated union on `kind`) and
`ToolWeaveConfig { crossGroupView?: boolean; installOptions?: ToolInstallOption[] }`
in a new `libs/api/src/tool-config.ts`, exported from the package index.
TypeBox twins in `shared/types/src/`.

## Initial values, required, unset

- A field's initial value is the declaration `default`, else the manifest
  default for that key when its type matches the kind, else empty.
- `boolean` always has a value and is always written.
- For the other kinds, an empty field is "unset". Required plus unset blocks
  submit. Optional plus unset writes nothing, so the key keeps the manifest
  default or stays absent.
- `agentList` treats an empty selection as unset.

## Null as a value

Unset means "leave the key as the manifest has it", never "write null".
That is the safe default: most DNA properties are plain Rust types, and a
`null` written into one fails genesis for every member. A Tool whose
property is an `Option<T>` opts in with `nullable: true`. For such an
option an empty field writes `null`, `default: null` is allowed, and the
initial value is the declaration default, else the manifest value, else
`null`. `boolean` has no `nullable` because a switch cannot show a third
state; `required` with `nullable` is contradictory and rejected. Dev-config
overrides are raw values, so `null` there is simply written.

## Merge rule (form vs YAML editor)

The YAML editor is the base; the form overlays it at submit. Per role: parse
the editor's YAML (or the manifest defaults when the editor was never shown),
then set each option's key to the form's value when the option has one, or
to `null` when the option is nullable and empty. The
full per-role object is sent, so keys the options never touch (Vines'
`groupName`, `minTopicNameLength`, ...) survive. A hand edit in the editor to
a declared key is overridden by the form, and the editor's help text says so.
Roles that no option writes and whose editor was not shown are omitted, so
the conductor uses the manifest defaults, exactly as today.

## Reading the declaration

The existing `fetch-and-validate-happ-or-webhapp` IPC handler already gunzips
and msgpack-decodes the webhapp to pull role defaults out of the happ. Extend
it to also open the UI zip resource in memory (`adm-zip` is a dependency) and
read `weave.config.json`, returning it under a new `weaveConfig` field. Give
the handler a real return type; it is `Promise<any>` today. For a bare happ
plus `uiPort`, the handler fetches
`http://localhost:<uiPort>/weave.config.json` instead. The zip reader lives
in its own module with no `electron` import so it runs under vitest; the
port fetch stays with the other `net.fetch` helpers. Absent or unparsable
config means "no options", not an error; the malformed-declaration error is
only for a config that parses but fails the checks above.

## Install dialog

- New element `install-options-form` in
  `src/renderer/src/tool-library/elements/`, rendered by the dialog between
  the custom-name field and "Show Advanced". It owns its values as state and
  exposes them to the dialog; the dialog does not parse them out of FormData.
- Controls follow existing renderer practice: `sl-switch` for boolean,
  `sl-select` with `sl-option` for choices, `sl-input` for string and number,
  `sl-select multiple` over `groupStore.allProfiles` with `agent-avatar` and
  nickname for `agentList`. Hover text is `sl-tooltip`; shared classes from
  `shared-styles.ts`.
- Required and range errors use native constraint validation
  (`required` plus `setCustomValidity`), the same way the custom-name field
  blocks submit today. Install is not disabled; submit is blocked with an
  inline message. This matches the existing dialog rather than the brief's
  "button enables" wording.
- Pure logic (declaration checks, initial values, value validation, merge)
  lives in `src/renderer/src/tool-library/install-options.ts` with no DOM
  dependencies so it runs under `yarn test:unit`.

## Install path

`installApplet` in the dialog builds the merged per-role properties and
passes them to `installAndAdvertiseApplet` as it does today. Nothing in
`group-store.ts`, `moss-store.ts`, or the main-process install handler
changes.

## Dev mode

- `AppletInstallConfig` gains
  `properties?: Record<string, Record<string, unknown>>` keyed by role name.
  `devSetup.ts` reads the happ manifest defaults (via `decompressHapp` on the
  happ path it already has), merges the overrides per role, msgpack-encodes
  them into the `Applet` entry, and passes matching `roles_settings` to
  `installHapp`.
- The joiner path in `devSetup.ts` derives `roles_settings` from the gossiped
  `Applet` entry's `properties`. Move `rolesSettingsFor` out of `moss-store.ts`
  into `@theweave/utils` so main and renderer share one implementation.
- The committed `cli/defineConfig.js` and `.d.ts` are regenerated by
  `yarn build:cli`'s last step (`tsc -p tsconfig.defineConfig.json`).
- `example/ui/weave.config.json` declares one option of each kind and the
  example dev config sets a couple of them, giving a runnable acceptance
  check with `yarn applet-dev-example`. The example is a `localhost` Tool, so
  this also exercises the port-based declaration fetch. The forum integrity
  zome deserializes properties into `ExampleDnaProperties { invalid }` without
  `deny_unknown_fields`, so extra keys are ignored.

## Docs

- New page `docs/build/tool-install-options.md`, linked from the VitePress
  sidebar after "Configure CLI". It documents `weave.config.json` as a whole
  (nothing in `docs/build/` mentions the file today), each kind with an
  example, required vs optional, the overlay-merge rule, and the "fixed at
  install, identical for every member" rule.
- `docs/build/configure-cli.md` documents the new `properties` field.

## Testing

- `yarn test:unit` (vitest, node): `install-options.test.ts` for declaration
  checks, initial values, value validation, and merge; a main-process test
  that builds a synthetic webhapp (gzip of msgpack with a zip resource) and
  reads `weave.config.json` from it; a test for the shared `rolesSettingsFor`
  round trip; the existing IPC drift guard stays green.
- Manual: `yarn applet-dev-example` with two agents, installer sets options,
  joiner's cell shows the same properties under "view DNA properties".
- Vines end-to-end is out of scope here; it needs Vines' declarations.

## Left to the builder

- Exact layout and spacing of the form, matched to neighbouring fields.
- Whether `agentList` lists members without a profile (recommend: no).
- Splitting `install-tool-dialog.ts` further if it helps; it must not grow.
