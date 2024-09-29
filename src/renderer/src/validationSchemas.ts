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

// const AppAuthenticationToken = Type.Array(Type.Number());

const AppletHash = EntryHash;
// const AppletId = EntryHashB64;

const Hrl = Type.Tuple([DnaHash, Type.Union([ActionHash, EntryHash])]);
// const HrlB64 = Type.Tuple([DnaHashB64, Type.Union([ActionHashB64, EntryHashB64])]);

const OpenWalMode = Type.Union([
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
      type: Type.Literal('cross-applet-main'),
      appletBundleId: ActionHash,
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
      type: Type.Literal('cross-applet-block'),
      appletBundleId: ActionHash,
      block: Type.String(),
      context: Type.Any(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('wal'),
      wal: WAL,
      mode: Type.Optional(OpenWalMode),
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
      reason: Type.Any(),
    },
    { additionalProperties: false },
  ),
]);

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
      crossApplet: Type.Boolean(),
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
      type: Type.Literal('get-global-asset-info'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('wal-to-pocket'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('drag-wal'),
      wal: WAL,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('request-bind'),
      srcWal: WAL,
      dstWal: WAL,
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
      type: Type.Literal('user-select-wal'),
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
      type: Type.Literal('localStorage.setItem'),
      key: Type.String(),
      value: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('localStorage.removeItem'),
      key: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('localStorage.clear'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('get-localStorage'),
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
]);
