import { Type, Static } from '@sinclair/typebox';
import type { ToolInstallOption, ToolWeaveConfig } from '@theweave/api';

/**
 * Runtime twins of `ToolInstallOption` / `ToolWeaveConfig` from
 * `@theweave/api`, used to check a Tool's `weave.config.json` before its
 * options are rendered.
 */
const TOptionBase = {
  role: Type.String(),
  property: Type.String(),
  label: Type.String(),
  description: Type.Optional(Type.String()),
  required: Type.Boolean(),
};

const TNullable = { nullable: Type.Optional(Type.Boolean()) };

const TStringChoice = Type.Object({ value: Type.String(), label: Type.String() });
const TNumberChoice = Type.Object({ value: Type.Number(), label: Type.String() });

export const TToolInstallOption = Type.Union([
  Type.Object(
    { ...TOptionBase, kind: Type.Literal('boolean'), default: Type.Optional(Type.Boolean()) },
    { additionalProperties: false },
  ),
  Type.Object({
    ...TOptionBase,
    ...TNullable,
    kind: Type.Literal('stringChoice'),
    choices: Type.Array(TStringChoice),
    default: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  Type.Object({
    ...TOptionBase,
    ...TNullable,
    kind: Type.Literal('numberChoice'),
    choices: Type.Array(TNumberChoice),
    default: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  }),
  Type.Object({
    ...TOptionBase,
    ...TNullable,
    kind: Type.Literal('string'),
    minLength: Type.Optional(Type.Number()),
    maxLength: Type.Number(),
    default: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  Type.Object({
    ...TOptionBase,
    ...TNullable,
    kind: Type.Literal('number'),
    min: Type.Number(),
    max: Type.Number(),
    integer: Type.Boolean(),
    default: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  }),
  Type.Object({
    ...TOptionBase,
    ...TNullable,
    kind: Type.Literal('agentList'),
    minItems: Type.Optional(Type.Number()),
    maxItems: Type.Optional(Type.Number()),
  }),
]);

export const TToolWeaveConfig = Type.Object(
  {
    crossGroupView: Type.Optional(Type.Boolean()),
    installOptions: Type.Optional(Type.Array(TToolInstallOption)),
  },
  { additionalProperties: true },
);

// Keeps the schema and the hand-written api types from drifting apart.
type _CheckOption = Static<typeof TToolInstallOption> extends ToolInstallOption ? true : never;
type _CheckConfig = Static<typeof TToolWeaveConfig> extends ToolWeaveConfig ? true : never;
export const _toolConfigSchemaMatchesApi: [_CheckOption, _CheckConfig] = [true, true];

/**
 * DNA properties per role name, as read from a happ manifest or chosen at
 * install time.
 */
export type RoleProperties = Record<string, Record<string, unknown>>;

/**
 * What the main process reports back after downloading and validating a
 * `.happ` or `.webhapp`: the hashes, each role's default DNA properties,
 * and the Tool's `weave.config.json` when one could be read (unchecked JSON).
 */
export type HappOrWebhappInspection =
  | {
      type: 'happ';
      sha256: string;
      roles: RoleProperties;
      weaveConfig?: unknown;
    }
  | {
      type: 'webhapp';
      sha256: string;
      happ: { sha256: string; roles: RoleProperties };
      ui: { sha256: string };
      weaveConfig?: unknown;
    };
