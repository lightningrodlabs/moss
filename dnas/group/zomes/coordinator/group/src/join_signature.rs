use group_integrity::*;
use hdk::prelude::*;
use moss_helpers::ZomeFnInput;

use crate::steward_permission::{get_my_accountabilities, Accountability};

/// What a signer hands out for an offline invite link. The joiner's client
/// turns it into a `JoinSignature` by signing its own agent key with the
/// invite private key.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InviteDelegation {
    pub signer: AgentPubKey,
    pub steward_credential: Vec<StewardCredential>,
    pub delegation: Delegation,
}

/// Approves `joining_agent` with the caller's agent key.
#[hdk_extern]
pub fn sign_join_invitation(joining_agent: AgentPubKey) -> ExternResult<JoinSignature> {
    let me = agent_info()?.agent_initial_pubkey;
    let bytes = join_payload_bytes(&dna_info()?.hash, &joining_agent);
    Ok(JoinSignature {
        signature: sign_raw(me.clone(), bytes)?,
        steward_credential: my_steward_credential()?,
        signer: me,
        delegation: None,
    })
}

/// Approves a one-time invite key with the caller's agent key, for an offline
/// invite link. The invite private key stays with the client.
#[hdk_extern]
pub fn sign_invite_delegation(invite_key: AgentPubKey) -> ExternResult<InviteDelegation> {
    let me = agent_info()?.agent_initial_pubkey;
    let bytes = delegation_payload_bytes(&dna_info()?.hash, &invite_key);
    Ok(InviteDelegation {
        delegation: Delegation {
            delegation_signature: sign_raw(me.clone(), bytes)?,
            invite_key,
        },
        steward_credential: my_steward_credential()?,
        signer: me,
    })
}

/// The signed permission records proving that the holder of
/// `permission_hash` is a steward, from that permission back to the one the
/// progenitor issued. The progenitor uses this to give a first steward the
/// credential it cites when joining.
#[hdk_extern]
pub fn get_steward_credential(permission_hash: ActionHash) -> ExternResult<Vec<StewardCredential>> {
    let mut chain = Vec::new();
    let mut next = Some(permission_hash);
    while let Some(hash) = next {
        if chain.len() == MAX_STEWARD_CHAIN {
            return Err(wasm_error!(WasmErrorInner::Guest(format!(
                "Steward permission chain is longer than {MAX_STEWARD_CHAIN}"
            ))));
        }
        let record = get(hash.clone(), GetOptions::network())?.ok_or(wasm_error!(
            WasmErrorInner::Guest(format!("Steward permission {hash} not found"))
        ))?;
        let permission = record
            .entry()
            .to_app_option::<StewardPermission>()
            .map_err(|e| wasm_error!(e))?
            .ok_or(wasm_error!(WasmErrorInner::Guest(format!(
                "Record {hash} is not a StewardPermission"
            ))))?;
        next = permission.permission_hash.clone();
        chain.push(StewardCredential {
            action: record.action().clone(),
            signature: record.signature().clone(),
            permission,
        });
    }
    Ok(chain)
}

/// The caller's credential, or empty if the caller holds no non-expiring
/// steward permission.
fn my_steward_credential() -> ExternResult<Vec<StewardCredential>> {
    match my_non_expiring_permission_hash()? {
        Some(hash) => get_steward_credential(hash),
        None => Ok(vec![]),
    }
}

/// The caller's non-expiring steward permission, the only kind the join
/// gate accepts.
fn my_non_expiring_permission_hash() -> ExternResult<Option<ActionHash>> {
    let accountabilities = get_my_accountabilities(ZomeFnInput {
        input: sys_time()?,
        local: None,
    })?;
    Ok(accountabilities.into_iter().find_map(|acc| match acc {
        Accountability::Steward(claim) if claim.permission.expiry.is_none() => {
            Some(claim.permission_hash)
        }
        _ => None,
    }))
}

/// How the agent-activity authorities see an agent's join.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum JoinStatus {
    /// The `CreateAgent` action passed validation and no warrant exists.
    Valid,
    /// The join was rejected, or the agent has a warrant for any action.
    Invalid,
    /// No authority has accepted or rejected the join yet. This can last
    /// indefinitely, so callers must not treat it as admitted.
    Pending,
}

/// Whether `agent` joined this group validly. Uses this node's own view as an
/// agent-activity authority when it has one, because a network query can be
/// answered by the very agent being checked.
#[hdk_extern]
pub fn get_agent_join_status(agent: AgentPubKey) -> ExternResult<JoinStatus> {
    let local = agent_activity(&agent, GetOptions::local())?;
    let activity = match local.status {
        ChainStatus::Empty => agent_activity(&agent, GetOptions::network())?,
        _ => local,
    };
    Ok(join_status(&activity))
}

fn agent_activity(agent: &AgentPubKey, options: GetOptions) -> ExternResult<AgentActivityStatus> {
    get_agent_activity(agent.clone(), ChainQueryFilter::new(), ActivityRequest::Full, options)
}

/// The `CreateAgent` action is always at sequence 2 of a source chain.
const CREATE_AGENT_SEQ: u32 = 2;

fn join_status(activity: &AgentActivityStatus) -> JoinStatus {
    let rejected = activity.rejected_activity.iter().any(|(seq, _)| *seq <= CREATE_AGENT_SEQ);
    if rejected || !activity.warrants.is_empty() {
        return JoinStatus::Invalid;
    }
    if activity.valid_activity.iter().any(|(seq, _)| *seq == CREATE_AGENT_SEQ) {
        JoinStatus::Valid
    } else {
        JoinStatus::Pending
    }
}
