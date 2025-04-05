/**
 * This file contains the necessary schemas to validate iframe messages.
 *
 * The corresponding typescript types are defined in libs/api/types.ts
 */

import { Type } from '@sinclair/typebox';

const EntryHash = Type.Uint8Array({ minByteLength: 39, maxByteLength: 39 });
const ActionHash = Type.Uint8Array({ minByteLength: 39, maxByteLength: 39 });
const DnaHash = Type.Uint8Array({ minByteLength: 39, maxByteLength: 39 });
const AgentPubKey = Type.Uint8Array({ minByteLength: 39, maxByteLength: 39 });
// const NullHash = Type.Uint8Array({ minByteLength: 39, maxByteLength: 39 });

// const EntryHashB64 = Type.String({ pattern: '^uhCEk' });
// const ActionHashB64 = Type.String({ pattern: '^uhCkk' });
// const DnaHashB64 = Type.String({ pattern: '^uhC0k' });
// const AgentPubKeyB64 = Type.String({ pattern: '^uhCAk' });

const CellId = Type.Tuple([DnaHash, AgentPubKey]);
const RoleName = Type.String();
const ZomeName = Type.String();
const FunctionName = Type.String();

const CallZomeRequest = Type.Object(
  {
    cap_secret: Type.Optional(Type.Union([Type.Uint8Array(), Type.Null()])),
    cell_id: CellId,
    zome_name: ZomeName,
    fn_name: FunctionName,
    payload: Type.Any(),
    provenance: AgentPubKey,
  },
  { additionalProperties: false },
);

const MembraneProof = Type.Uint8Array();
const Timestamp = Type.Number();
/**
 * Any Yaml serializable properties
 */
const DnaProperties = Type.Unknown();
const Duration = Type.Object(
  {
    secs: Type.Number(),
    nanos: Type.Number(),
  },
  { additionalProperties: false },
);

const DnaModifiersOpt = Type.Object(
  {
    network_seed: Type.Optional(Type.String()),
    properties: Type.Optional(DnaProperties),
    origin_time: Type.Optional(Timestamp),
    quantum_time: Type.Optional(Duration),
  },
  { additionalProperties: false },
);

const CreateCloneCellRequest = Type.Object(
  {
    role_name: RoleName,
    modifiers: DnaModifiersOpt,
    membrane_proof: Type.Optional(MembraneProof),
    name: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const DisableCloneCellRequest = Type.Object(
  {
    clone_cell_id: Type.Union([RoleName, DnaHash]),
  },
  { additionalProperties: false },
);

const EnableCloneCellRequest = DisableCloneCellRequest;

// const AppAuthenticationToken = Type.Array(Type.Number());

const AppletHash = EntryHash;
// const AppletId = EntryHashB64;

const Hrl = Type.Tuple([DnaHash, Type.Union([ActionHash, EntryHash])]);
// const HrlB64 = Type.Tuple([DnaHashB64, Type.Union([ActionHashB64, EntryHashB64])]);

const OpenAssetMode = Type.Union([
  Type.Literal('front'),
  Type.Literal('side'),
  Type.Literal('window'),
]);

const WAL = Type.Object(
  {
    hrl: Hrl,
    context: Type.Optional(Type.Any()),
  },
  { additionalProperties: false },
);

// const WeaveUrl = Type.String({ pattern: '^weave(-d+(.d+)?)?://' });

// const WeaveLocation = Type.Union([
//   Type.Object({
//     type: Type.Literal('group'),
//     dnaHash: DnaHash,
//   }, { additionalProperties: false }),
//   Type.Object({
//     type: Type.Literal('applet'),
//     appletHash: AppletHash,
//   }, { additionalProperties: false }),
//   Type.Object({
//     type: Type.Literal('asset'),
//     wal: WAL,
//   }, { additionalProperties: false }),
//   Type.Object({
//     type: Type.Literal('invitation'),
//     secret: Type.String(),
//   }, { additionalProperties: false }),
// ]);

const FrameNotification = Type.Object(
  {
    title: Type.String(),
    body: Type.String(),
    notification_type: Type.String(),
    icon_src: Type.Union([Type.String(), Type.Undefined()]),
    urgency: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
    timestamp: Type.Number({ minimum: 1500000000000, maximum: 20000000000000 }),
    aboutWal: Type.Optional(WAL),
    fromAgent: Type.Optional(AgentPubKey),
    forAgents: Type.Optional(Type.Array(AgentPubKey)),
    // customCountReset?: NotificationId;
  },
  { additionalProperties: false },
);

const OpenViewRequest = Type.Union([
  Type.Object(
    {
      type: Type.Literal('applet-main'),
      appletHash: EntryHash,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('cross-group-main'),
      appletBundleId: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('applet-block'),
      appletHash: EntryHash,
      block: Type.String(),
      context: Type.Any(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('cross-group-block'),
      appletBundleId: Type.String(),
      block: Type.String(),
      context: Type.Any(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('asset'),
      wal: WAL,
      mode: Type.Optional(OpenAssetMode),
    },
    { additionalProperties: false },
  ),
]);

const CreatableName = Type.String();

const CreatableType = Type.Object(
  {
    label: Type.String(),
    icon_src: Type.String(),
    width: Type.Optional(
      Type.Union([Type.Literal('small'), Type.Literal('medium'), Type.Literal('large')]),
    ),
    height: Type.Optional(
      Type.Union([Type.Literal('small'), Type.Literal('medium'), Type.Literal('large')]),
    ),
  },
  { additionalProperties: false },
);

const CreatableResult = Type.Union([
  Type.Object(
    {
      type: Type.Literal('success'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('cancel'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('error'),
      error: Type.Any(),
    },
    { additionalProperties: false },
  ),
]);

const ZomeCallLogInfo = Type.Object(
  {
    fnName: Type.String(),
    installedAppId: Type.String(),
    durationMs: Type.Number(),
  },
  { additionalProperties: false },
);

export const AppletToParentRequest = Type.Union([
  Type.Object(
    {
      type: Type.Literal('ready'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('get-iframe-config'),
      // TODO remove the crossGroup field altogether once it's removed in @theweave/api
      // since it's not required anymore
      crossGroup: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('get-record-info'),
      hrl: Hrl,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('sign-zome-call'),
      request: CallZomeRequest,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('log-zome-call'),
      info: ZomeCallLogInfo,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('open-view'),
      request: OpenViewRequest,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('search'),
      filter: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('notify-frame'),
      notifications: Type.Array(FrameNotification),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('get-applet-info'),
      appletHash: AppletHash,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('get-group-profile'),
      groupHash: DnaHash,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('my-group-permission-type'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('applet-participants'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('user-select-screen'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('toggle-pocket'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('update-creatable-types'),
      value: Type.Record(CreatableName, CreatableType),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('creatable-result'),
      result: CreatableResult,
      dialogId: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('get-applet-iframe-script'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('request-close'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('send-remote-signal'),
      payload: Type.Uint8Array(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('create-clone-cell'),
      req: CreateCloneCellRequest,
      publicToGroupMembers: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('enable-clone-cell'),
      req: EnableCloneCellRequest,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('disable-clone-cell'),
      req: DisableCloneCellRequest,
    },
    { additionalProperties: false },
  ),
  /**
   * Asset related requests
   */
  Type.Object(
    {
      type: Type.Literal('asset-to-pocket'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('asset-to-pocket'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('user-select-asset'),
      from: Type.Optional(
        Type.Union([Type.Literal('search'), Type.Literal('pocket'), Type.Literal('create')]),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('user-select-asset-relation-tag'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('get-global-asset-info'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('drag-asset'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('add-tags-to-asset'),
      wal: WAL,
      tags: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('remove-tags-from-asset'),
      wal: WAL,
      tags: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('add-asset-relation'),
      srcWal: WAL,
      dstWal: WAL,
      tags: Type.Optional(Type.Array(Type.String())),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('remove-asset-relation'),
      relationHash: EntryHash,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('add-tags-to-asset-relation'),
      relationHash: EntryHash,
      tags: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('remove-tags-from-asset-relation'),
      relationHash: EntryHash,
      tags: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('get-all-asset-relation-tags'),
      crossGroup: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('subscribe-to-asset-store'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('unsubscribe-from-asset-store'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('unsubscribe-from-asset-store'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
]);
