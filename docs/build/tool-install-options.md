# Install Options

A Tool can declare a small set of **install options**. When someone adds the Tool to a group, Moss shows them as form fields in the install dialog and writes the chosen values into the Tool's DNA properties. Use this for behaviour that is fixed per instance, such as a "stewarded" switch or a list of members with a special role.

## `weave.config.json`

The declaration lives in `weave.config.json` at the root of your Tool's UI assets, next to `index.html`, so it ships inside the `.webhapp` and is versioned with your code. The file has two keys, both optional:

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

- `crossGroupView` says whether your UI supports Moss's cross-group view.
- `installOptions` is the list described below. The TypeScript types `ToolWeaveConfig` and `ToolInstallOption` are exported from `@theweave/api`.

## Common fields

Every option has:

| Field         | Meaning                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `role`        | The role in your happ manifest whose DNA properties the option writes.          |
| `property`    | The key within that role's properties. `role` + `property` identify the option. |
| `kind`        | One of the kinds below.                                                         |
| `label`       | The field label (text, see below).                                              |
| `description` | Optional help text under the field (text, see below).                           |
| `required`    | `true` blocks installation until the field holds a valid value.                 |
| `nullable`    | Optional, not on `boolean`. Lets an empty field write `null` (see below).       |
| `dependsOn`   | Optional. Conditions on earlier options (see "Conditional options" below).      |

### Text in more than one language

`label`, `description`, and each choice's `label` take either a plain string
or a map keyed by language tag. A plain string is shown in every language. With
a map, Moss picks the installer's language, then the language without its
region (`pt` for `pt-BR`), then `en`, then the first entry:

```json
"label": "Stewarded",
"description": {
  "en": "Only stewards create categories and channels.",
  "de": "Nur Verwalter erstellen Kategorien und Kanäle."
}
```

## Kinds

**`boolean`** — a switch. Always writes `true` or `false`.

```json
{
  "role": "forum",
  "property": "stewarded",
  "kind": "boolean",
  "label": "Stewarded",
  "required": false,
  "default": false
}
```

**`stringChoice`** — a select over fixed string values.

```json
{
  "role": "forum",
  "property": "theme",
  "kind": "stringChoice",
  "label": "Theme",
  "required": false,
  "choices": [
    { "value": "light", "label": "Light" },
    { "value": "dark", "label": "Dark" }
  ]
}
```

**`numberChoice`** — a select over fixed numeric values.

```json
{
  "role": "forum",
  "property": "pageSize",
  "kind": "numberChoice",
  "label": "Page size",
  "required": false,
  "choices": [
    { "value": 10, "label": "10" },
    { "value": 25, "label": "25" }
  ]
}
```

**`stringChoiceList`** — a multi-select over fixed string values. Optional `minItems` and `maxItems`, and a `default` list. Written as a list of the chosen values, in the order the `choices` declare them (`Vec<String>` in Rust). An empty list counts as empty, so `required` means at least one value.

```json
{
  "role": "forum",
  "property": "categories",
  "kind": "stringChoiceList",
  "label": "Categories",
  "required": false,
  "maxItems": 2,
  "choices": [
    { "value": "news", "label": "News" },
    { "value": "events", "label": "Events" },
    { "value": "help", "label": "Help" }
  ],
  "default": ["news"]
}
```

**`string`** — free text. `maxLength` is required so no option is unbounded; `minLength` defaults to 0.

```json
{
  "role": "forum",
  "property": "motto",
  "kind": "string",
  "label": "Motto",
  "required": false,
  "maxLength": 40
}
```

**`number`** — a number within `min` and `max`. `integer: true` rejects fractions; declare it for every Rust integer field.

```json
{
  "role": "forum",
  "property": "maxPosts",
  "kind": "number",
  "label": "Max posts",
  "required": true,
  "min": 1,
  "max": 1000,
  "integer": true
}
```

**`agentList`** — a multi-select over the group's members, shown by avatar and nickname. Optional `minItems` and `maxItems`. Written as a list of base64 agent keys in the `u`-prefixed form (`uhCAk…`). Members are shown under the same key the Tool's cell uses, so the keys match what your zome sees.

```json
{
  "role": "forum",
  "property": "moderators",
  "kind": "agentList",
  "label": "Moderators",
  "required": false,
  "maxItems": 5
}
```

## Defaults, required, empty

- Every kind except `agentList` accepts a `default`. A field starts at the declaration's `default`, else the happ manifest's value for that key when its type matches, else empty.
- A `required` option must hold a valid value before the Install button works. A required option whose key has a manifest default is pre-filled and can be submitted as is.
- An **empty** optional field writes nothing: the property keeps whatever your happ manifest says, and if the manifest has no such key, the key is absent. Moss never writes `null` into a property on its own, because a `null` in a plain Rust field fails genesis for every member.
- For an `Option<T>` property, set `nullable: true`. Then an empty field writes `null`, and `default: null` is allowed. `required` and `nullable` together are rejected as contradictory.

## Conditional options

`dependsOn` makes an option apply only when other options hold certain values. It is a list of conditions, and all of them must hold:

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
  "property": "accentColor",
  "kind": "string",
  "label": "Accent color",
  "required": false,
  "maxLength": 7,
  "dependsOn": [{ "property": "theme", "in": ["dark", "custom"] }]
}
```

Each condition names another option by `property`, and by `role` when it is not the same role as the dependent option. It holds when:

- with neither `equals` nor `in`: the other option is filled in. For a `boolean` that means `true`, for a list it means at least one item, and for the other kinds it means a value that is not `null`.
- with `equals`: the other option has that value. For a list, the list contains it.
- with `in`: the other option has one of the listed values. For a list, the list contains at least one of them.

An option that does not apply is hidden in the install dialog, is not checked (so `required` only counts while it applies), and is written as if it were empty. A condition on an option that does not apply never holds, so turning off one option hides the whole chain below it.

A condition must name an option declared earlier in the list. `equals` and `in` cannot be used together, their values must be values the other option can hold (one of its `choices` for the choice kinds), `in` must not be empty, and neither can be used on an `agentList`, nor `in` on a `boolean`. A declaration that breaks these rules is reported as malformed.

## How the values are written

- Moss validates every value against its declaration before installing: type, choice membership, length, range, integer-ness, and list size.
- Role properties replace the manifest's wholesale, so Moss merges the chosen values into the manifest's default properties for that role and sends the full set. Keys no option touches keep their manifest values. If the installer also edits the role's YAML under "Show Advanced", the form's values are applied on top of that YAML.
- **Values are fixed at install and identical for every member.** DNA properties are part of the DNA hash. The installer's merged properties are stored in the group's Applet entry, and every joining member installs with exactly those bytes. There is no way to change them later.
- A malformed declaration (unknown kind, a `role` not in the happ, `min > max`, a default outside its own constraints, …) is reported to the installer, who can still set properties through the YAML editor.

## Testing in dev mode

The dev config can set properties per applet instance so you can test what your options write without the dialog. The values are merged over the manifest defaults for the role, and joining agents install with the same properties:

```typescript
applets: [
  {
    name: 'Forum',
    instanceName: 'Forum',
    registeringAgent: 1,
    joiningAgents: [2],
    properties: { forum: { stewarded: true, maxPosts: 100 } },
  },
],
```

An `agentList` value cannot name other dev agents here, because the registering agent installs before the joining agents exist. Use a literal list or leave it unset.

To exercise the dialog itself, run your Tool with `weave --dev-config` and add it to the group a second time from the Tool Library: the install dialog fetches `weave.config.json` from your UI dev server.
