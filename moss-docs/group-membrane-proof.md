# Group Membrane Proof

The group DNA can restrict who joins a group. A joining agent presents a membrane proof at install time. The group's DNA properties hold a join policy, and every peer checks the proof against it.

Every check is deterministic. The checks use only the DNA properties and the contents of the proof, with no DHT lookups. Genesis and every peer therefore reach the same result. No check uses time, because validation has no clock and an agent sets its own action timestamps.

## DNA properties

```json
{
  "progenitor": "uhCAk...",
  "join_policy": { "type": "Progenitor" },
  "allow_delegated_invites": false
}
```

- `progenitor` is the group creator's agent key, or `null`.
- `join_policy` is optional. If it is absent, anyone with the network seed can join.
- `allow_delegated_invites` is optional and defaults to `false`.

If `join_policy` or `allow_delegated_invites` has its default value, leave it out. The properties are part of the DNA hash, so writing a default explicitly creates a different group.

## Join policies

A policy is a tree of gates. The JSON uses `{ "type": ..., "content": ... }`.

| Gate | JSON | Satisfied when |
|---|---|---|
| Progenitor | `{ "type": "Progenitor" }` | The progenitor signed. |
| Steward | `{ "type": "Steward" }` | A holder of a non-expiring `StewardPermission` signed, or the joiner holds one (see "First stewards"). The progenitor does not count as a steward. |
| External | `{ "type": "External", "content": { "keys": ["uhCAk..."], "threshold": 2 } }` | At least `threshold` distinct listed keys signed. The keys do not need to be group members. |
| AllowList | `{ "type": "AllowList", "content": { "agents": ["uhCAk..."] } }` | The joining agent is listed. No signature is needed. |
| AnyOf | `{ "type": "AnyOf", "content": [ ... ] }` | At least one child gate is satisfied. |
| AllOf | `{ "type": "AllOf", "content": [ ... ] }` | Every child gate is satisfied. |

Common policies:

- Signed by the progenitor or a steward: `AnyOf([Progenitor, Steward])`.
- Signed by both: `AllOf([Progenitor, Steward])`. This needs two different people.

The progenitor can always join without a proof.

Install fails for a policy that can never be satisfied or is too large:

- `threshold` is 0 or larger than the number of keys
- `AnyOf` or `AllOf` is empty
- `Progenitor` or `Steward` appears and `progenitor` is `null`
- `External.keys` has duplicates
- nesting is deeper than 8 levels, or a list has more than 64 entries

## Membrane proof

The proof is msgpack-encoded and passed as `membrane_proof` in the group role's `roles_settings` at `installApp`.

```ts
type GroupMembraneProof = {
  signatures: JoinSignature[]; // at most 64, one per signer
  own_steward_credential?: StewardCredential[];
};

type JoinSignature = {
  signer: AgentPubKey;
  steward_credential: StewardCredential[]; // empty if the signer claims no steward standing
  signature: Signature;
  delegation: { invite_key: AgentPubKey; delegation_signature: Signature } | null;
};

// A signed StewardPermission create record.
type StewardCredential = {
  action: Action;
  signature: Signature;
  permission: StewardPermission;
};
```

The coordinator zome function `sign_join_invitation(joining_agent)` returns a direct `JoinSignature` from the caller. If the caller holds a non-expiring permission, it fills `steward_credential`.

### Signed bytes

The signed bytes are plain concatenations, so any language can build them. Both functions sign with ed25519 over the raw bytes, with no msgpack.

```
join bytes       = "moss-group-join-v1"   ‖ dna_hash (39 bytes) ‖ joining_agent (39 bytes)
delegation bytes = "moss-group-invite-v1" ‖ dna_hash (39 bytes) ‖ invite_key (39 bytes)
```

The DNA hash binds a signature to one group, so a proof for one group cannot be reused in another.

Test vectors, with `dna_hash = hashFrom32AndType([1; 32], Dna)`:

- Join bytes for agent `hashFrom32AndType([2; 32], Agent)`:
  `6d6f73732d67726f75702d6a6f696e2d7631842d2401010101010101010101010101010101010101010101010101010101010101017ecfcebe842024020202020202020202020202020202020202020202020202020202020202020220493dfd`
- Delegation bytes for invite key `hashFrom32AndType([3; 32], Agent)`:
  `6d6f73732d67726f75702d696e766974652d7631842d2401010101010101010101010101010101010101010101010101010101010101017ecfcebe84202403030303030303030303030303030303030303030303030303030303030303033f5da112`

## Key exchange

A direct signature needs the joining agent's key before install. The exchange does not need both people online at the same time:

1. Moss generates the joiner's agent key before installing the group.
2. The joiner sends the public key to the signer over any channel.
3. The signer calls `sign_join_invitation` and sends the proof back.
4. The joiner installs with the proof.

If an attacker replaces the key on the channel, the signer approves the attacker. The signer must compare a key fingerprint with the joiner over a channel they trust.

## Delegated invites

If `allow_delegated_invites` is `true`, a signer can approve a one-time invite key instead of the joiner's key. This allows invite links that work with no contact between the two people.

1. The inviting client generates an ed25519 keypair, the invite key. The invite key only signs. It is never an agent and never authors a chain.
2. The signer calls `sign_invite_delegation(invite_key)`. It returns `{ signer, steward_credential, delegation }`.
3. The invite link carries that result and the invite private key.
4. The joiner's client generates the joiner's agent key and signs the join bytes with the invite private key. It builds the `JoinSignature` from the link data and that signature.

A delegated invite is a bearer token. Anyone who has the link can join, as many times as they want, and the link cannot be revoked. Validation cannot prove that an invite was not used before, and it has no clock for expiry. Each person who uses the link becomes a separate agent, so reuse does not fork a chain.

### Passcode-locked invites

To protect a link in transit, encrypt the invite private key under a passcode. Use libsodium `crypto_pwhash` (argon2id, at least `OPSLIMIT_MODERATE` and `MEMLIMIT_MODERATE`) with a random salt to derive a key. Then encrypt with `crypto_secretbox` and a random nonce. The link carries the salt, the nonce, and the ciphertext. The DNA never sees the passcode.

Do not put a passcode hash in the link, and do not put the passcode in the proof. A hash allows offline guessing, and the proof is public. A weak passcode can still be guessed offline from the ciphertext.

## Steward credentials

A steward credential proves steward standing from the proof alone. It is a list of signed `StewardPermission` create records, at most 4. The first is the permission for the steward. Each next one is the permission of the agent who issued the previous one. The last one is issued by the progenitor.

Validation checks each record:

- The action creates a `StewardPermission`, and its entry hash matches the permission.
- The action's author signed it.
- The permission has no expiry and was not issued for its own author.
- Each permission is for the author of the previous record, and the last author is the progenitor.

The coordinator zome function `get_steward_credential(permission_hash)` builds a credential from a permission's action hash.

## First stewards

Under a `Steward` or `AllOf([Progenitor, Steward])` policy, the first steward has no steward to sign for them. The progenitor creates a `StewardPermission` for the new steward's agent key before that agent joins. The progenitor then calls `get_steward_credential` for it and gives the result to the joiner, who sets it as `own_steward_credential`. This counts the joiner as a steward signer. It never counts toward an `External` threshold.

## Join status

`get_agent_join_status(agent)` returns `Valid`, `Invalid`, or `Pending`. It reads this node's agent-activity data first, and the network only if this node has none. A rejected `CreateAgent` or any warrant against the agent gives `Invalid`. An accepted `CreateAgent` gives `Valid`. Otherwise the result is `Pending`, which can last indefinitely, so Moss must not treat `Pending` as admitted.

## Security notes

- The gate is not read access control. A person who has the network seed can still connect, gossip, and read group data while peers check their join. A failed join makes their chain invalid and gets them warranted, so peers reject their writes and block them.
- Genesis runs the same checks as peers. An agent with a forged, expiring, or borrowed steward credential cannot install.
- Steward permissions and the join gate:
  - Expiring permissions never satisfy the `Steward` gate, because validation cannot tell whether the expiry date is in the past. A steward with an expiring permission can still do the other steward actions, but cannot admit members.
  - An honest Moss client can check its own permission against its clock and refuse to sign after the permission expires. This is a courtesy, not a security boundary: a steward with a modified client can still sign, and validation cannot tell. For that reason the DNA accepts only non-expiring permissions.
  - Non-expiring permissions last for the life of the group. They cannot be deleted or updated, and a revocation entry does not help, because validation cannot prove that no such entry exists. If such a steward's key is stolen, or the steward turns hostile, that key can admit members for as long as the group exists. The only remedy is a new group.
  - Give non-expiring steward permissions only to people you trust for the life of the group.
- The proof is public. Anyone with the network seed can see who signed each member's proof.
