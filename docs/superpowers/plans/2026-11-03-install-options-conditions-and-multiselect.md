# Install Options: Conditions and Multi-Select Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two additions to Tool install options. First, an option can declare that it is active only when other options hold values. Second, a new `stringChoiceList` kind lets the installer pick several values from a fixed string list.

**Builds on:** `docs/superpowers/plans/2026-11-02-tool-install-options.md` (landed on `main-0.7` in #263 and earlier).

**Branch:** `feat/install-options-conditions` off `main-0.7`.

## Design

### 1. `stringChoiceList` kind

A new kind, not a `multiple` flag on `stringChoice`. The written value changes from `string` to `string[]` (`Vec<String>` in Rust), and a separate discriminant keeps the TypeScript union and the TypeBox schema exact.

```json
{
  "role": "forum",
  "property": "categories",
  "kind": "stringChoiceList",
  "label": "Categories",
  "required": false,
  "minItems": 1,
  "maxItems": 3,
  "choices": [
    { "value": "news", "label": "News" },
    { "value": "events", "label": "Events" },
    { "value": "help", "label": "Help" }
  ],
  "default": ["news"]
}
```

| Field      | Rule                                                                 |
| ---------- | -------------------------------------------------------------------- |
| `choices`  | Same as `stringChoice`: non-empty, unique values.                    |
| `minItems` | Optional. Must be at most `maxItems` and at most `choices.length`.   |
| `maxItems` | Optional.                                                            |
| `default`  | Optional `string[]` (or `null` when `nullable`). Must pass validation. |
| `nullable` | Same meaning as on other kinds.                                      |

Behavior:

- An empty list counts as unset, the same as `agentList`. `required` means at least one item.
- Validation: array of strings, every item a declared choice, no duplicates (`not-a-choice` / `wrong-type`), then `too-few` / `too-many`.
- The written array is in declaration order of `choices`, not click order, so the same selection always gives the same bytes.
- The manifest default seeds the field when it is an array of declared choices.
- UI: `sl-select multiple clearable`, with option values carried by index (reuse the existing reason: Shoelace rewrites values with spaces). New helpers `choicesAtIndices` and `indicesOfChoices` beside `choiceAtIndex`.
- The `too-few` / `too-many` messages currently say "members". They become kind-aware: "Select at least N members" for `agentList`, "Select at least N" for `stringChoiceList`.

No `numberChoiceList` for now. It is a small follow-up if a Tool needs it.

### 2. Conditions: `dependsOn`

A new optional field on every option:

```json
{
  "role": "forum",
  "property": "stewards",
  "kind": "agentList",
  "label": "Stewards",
  "required": true,
  "dependsOn": [{ "property": "stewarded" }]
},
{
  "role": "forum",
  "property": "customTheme",
  "kind": "string",
  "label": "Custom theme CSS",
  "required": false,
  "maxLength": 2000,
  "dependsOn": [{ "property": "theme", "equals": "custom" }]
}
```

```ts
type InstallOptionCondition = {
  /** Defaults to the dependent option's own role. */
  role?: string;
  property: string;
  /** The target equals this value. */
  equals?: boolean | string | number;
  /** The target equals one of these values. */
  in?: Array<string | number>;
};
```

Semantics:

- The option is active when every condition in the list holds (AND). OR is not supported. A Tool that needs OR can restructure, or we add `dependsOnAny` later.
- "Filled in" means the target is active, set, and not `null`. For a `boolean` target, filled in means `true`. For list kinds, it means non-empty.
- With neither `equals` nor `in`, the condition means the target is filled in. A condition with both is rejected.
- `in` holds when the target equals any listed value. It is the only form of OR.
- On a list kind, `equals` means the list includes the value, and `in` means the list includes at least one listed value.
- A condition on an inactive target is false. Activity therefore cascades down a chain.
- An inactive option is hidden in the form, is not checked (so `required` applies only while active), and is merged exactly as an unset field: nothing is written, or `null` when `nullable`.
- The form keeps a hidden option's value, so turning the parent off and on again restores what the installer typed. The value is ignored at merge while inactive.

Declaration checks (new `DeclarationProblem` code `bad-condition`):

- The target option exists in the list.
- The target is declared before the dependent option. This rules out self-reference and cycles without a graph search, and it puts the parent above the child in the form.
- `equals` matches the target kind: `boolean` for `boolean`, a declared choice value for the choice kinds, a string for `string`, a number for `number`. `equals` on `agentList` is rejected. `in` follows the same type rules for each value, must be non-empty, and is rejected on `boolean` and `agentList`.

### Decisions

1. An inactive option is hidden, not disabled.
2. Conditions combine with AND. `in` covers OR over the values of one option. OR across different options waits for a real Tool that needs it.
3. The field is `dependsOn`. It names a fact about the option, not a UI behavior.

## Files

- `libs/api/src/tool-config.ts`: `InstallOptionCondition`, `dependsOn` on the base, the `stringChoiceList` member.
- `shared/types/src/tool-config.ts` and its test: the TypeBox twins.
- `src/renderer/src/tool-library/install-options.ts`: `stringChoiceList` in `checkDeclarations`, `matchesKind`, `initialValues`, `isUnset`, `validateValue`, `mergeProperties`. index helpers.
- New `src/renderer/src/tool-library/install-option-conditions.ts` (+ test): `checkConditions(options)` and `activeOptionKeys(options, values): Set<string>`. Kept apart so `install-options.ts` (about 260 lines) does not absorb it.
- `src/renderer/src/tool-library/install-options-messages.ts` (+ test): `bad-condition`, kind-aware list counts.
- `src/renderer/src/tool-library/elements/install-options-form.ts`: `renderChoiceList`, hide inactive options, skip them in `reportValidity`.
- `src/renderer/xliff/*.xlf` and generated locales.
- `docs/build/tool-install-options.md`: the new kind and a "Conditional options" section.
- `example/ui/weave.config.json`: one `stringChoiceList`, one conditional option.

## Tasks

### Task 1: Types and schemas

- [ ] Failing schema tests in `shared/types/src/tool-config.test.ts`: accepts `stringChoiceList` with and without `minItems`/`maxItems`/`default`. accepts `dependsOn` with and without `role`/`equals`/`in`. rejects unknown keys on a condition. rejects `equals` of an object type.
- [ ] Add the types in `libs/api/src/tool-config.ts` and the schemas in `shared/types/src/tool-config.ts`. The `_toolConfigSchemaMatchesApi` check must still compile.
- [ ] `yarn test:unit`, `yarn typecheck`. Commit.

### Task 2: `stringChoiceList` logic

- [ ] Failing tests in `install-options.test.ts`: declaration problems (`bad-choices`, `bad-items` for `minItems > maxItems` and `minItems > choices.length`, `bad-default` for a non-choice, a duplicate, or a count out of range). `initialValues` from a declared default, from the manifest, and as `[]`. `validateValue` for every problem code. `mergeProperties` writes declaration order and leaves the key alone when empty and not nullable. index helpers round-trip a value that contains a space.
- [ ] Implement. Commit.

### Task 3: `stringChoiceList` form control

- [ ] Add `renderChoiceList` to `install-options-form.ts`, modeled on `renderAgentList` but with the index helpers.
- [ ] Kind-aware `too-few` / `too-many` in `install-options-messages.ts` (test first).
- [ ] Measure in the running dialog (rule 7): the select opens, chips wrap, and `currentValues` holds the typed strings in choice order. Commit.

### Task 4: Condition logic

- [ ] Failing tests in `install-option-conditions.test.ts`:
  - `checkConditions`: unknown target, target declared later, self-reference, `equals` of the wrong type, `equals` that is not a choice, `equals` on `agentList`, `equals` and `in` together, empty `in`, an `in` value of the wrong type or not a choice, `in` on `boolean`, `role` defaulting to the dependent's role.
  - `activeOptionKeys`: no conditions means active. filled-in for each kind (boolean `false` is not filled, `null` is not filled, `[]` is not filled). `equals` and `in` on scalar and list targets. AND of two conditions. a three-level cascade where the root turns off.
- [ ] Implement. Call `checkConditions` from `checkDeclarations` after the per-option checks.
- [ ] Change `mergeProperties` to treat an inactive option as unset. Add a `validateValues(options, values)` that returns problems only for active options. Tests first. Commit.

### Task 5: Conditional form

- [ ] In `install-options-form.ts`, compute `activeOptionKeys` in `render()` and skip inactive options. `reportValidity` checks active options only.
- [ ] A hidden text or number input loses its DOM node, so re-seed `_seeds[key]` from `_values[key]` when an option becomes active again. Otherwise the re-created input shows the original seed and not what the installer typed.
- [ ] Measure in the running dialog: toggle the parent and read back that the child appears, keeps its value, and that a required hidden child does not block Install. Commit.

### Task 6: Messages, translations, docs, example

- [ ] `bad-condition` message (test first). `npx lit-localize extract`, translate in all eight XLIFF files, `npx lit-localize build`, `yarn typecheck:web`.
- [ ] Update `docs/build/tool-install-options.md`.
- [ ] Add a `stringChoiceList` and a conditional option to the example Tool's `weave.config.json`. Extend the e2e install helper only if a new option is required. Neither new option needs to be required, so the existing e2e flow keeps working. Commit.

## Review focus

- A required option that is hidden does not block install, and nothing is written for it.
- A chain A → B → C: turning A off hides C even though B still holds a value.
- The `stringChoiceList` value written into DNA properties is a `string[]` in choice order.
- A declaration whose condition points to a later option is rejected, not silently ignored.
