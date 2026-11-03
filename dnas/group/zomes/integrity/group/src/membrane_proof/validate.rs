use std::collections::HashSet;

use hdi::prelude::*;

use super::{
    check_policy_shape, check_steward_chain, delegation_payload_bytes, gate_satisfied,
    join_payload_bytes, verify_steward_chain, GroupMembraneProof, JoinSignature,
    StewardCredential, VerifiedSigner, MAX_PROOF_SIGNATURES,
};
use crate::GroupDnaProperties;

fn invalid(reason: impl Into<String>) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(reason.into()))
}

/// Decides whether `joining_agent` may join the group, given the membrane proof
/// it presented. The decision uses only the DNA properties and the proof, with
/// no DHT lookups, so genesis and every peer reach the same result.
///
/// Every failure caused by untrusted input returns `Invalid`. Only host-function
/// failures return `Err`.
pub fn validate_join(
    joining_agent: &AgentPubKey,
    membrane_proof: &Option<MembraneProof>,
) -> ExternResult<ValidateCallbackResult> {
    let info = dna_info()?;
    let properties = match join_properties(info.modifiers.properties.clone()) {
        Ok(Some(p)) => p,
        Ok(None) => return Ok(ValidateCallbackResult::Valid),
        Err(e) => return invalid(e),
    };
    let Some(policy) = properties.join_policy else {
        return Ok(ValidateCallbackResult::Valid);
    };
    let progenitor = properties.progenitor.map(AgentPubKey::from);
    if let Err(e) = check_policy_shape(&policy, progenitor.as_ref()) {
        return invalid(e);
    }
    if progenitor.as_ref() == Some(joining_agent) {
        return Ok(ValidateCallbackResult::Valid);
    }
    if gate_satisfied(&policy, joining_agent, &[]) {
        return Ok(ValidateCallbackResult::Valid);
    }

    let Some(proof_bytes) = membrane_proof else {
        return invalid("This group requires a membrane proof to join");
    };
    let proof = match GroupMembraneProof::try_from(SerializedBytes::clone(proof_bytes)) {
        Ok(p) => p,
        Err(e) => return invalid(format!("Failed to deserialize the membrane proof: {e}")),
    };
    if proof.signatures.len() > MAX_PROOF_SIGNATURES {
        return invalid(format!(
            "The membrane proof has more than {MAX_PROOF_SIGNATURES} signatures"
        ));
    }
    let distinct: HashSet<&AgentPubKey> = proof.signatures.iter().map(|s| &s.signer).collect();
    if distinct.len() != proof.signatures.len() {
        return invalid("The membrane proof has more than one signature from the same signer");
    }

    let join_bytes = join_payload_bytes(&info.hash, joining_agent);
    let mut signers = Vec::with_capacity(proof.signatures.len() + 1);
    if !proof.own_steward_credential.is_empty() {
        if let Some(reason) =
            steward_credential_problem(&proof.own_steward_credential, joining_agent, progenitor.as_ref())?
        {
            return invalid(format!("Joining agent's steward credential: {reason}"));
        }
        signers.push(VerifiedSigner {
            key: joining_agent.clone(),
            is_progenitor: false,
            is_steward: true,
            signed: false,
        });
    }
    for signature in proof.signatures {
        if let Some(reason) = signature_problem(
            &signature,
            &info.hash,
            &join_bytes,
            properties.allow_delegated_invites,
        )? {
            return invalid(reason);
        }
        let is_steward = !signature.steward_credential.is_empty();
        if is_steward {
            if let Some(reason) = steward_credential_problem(
                &signature.steward_credential,
                &signature.signer,
                progenitor.as_ref(),
            )? {
                return invalid(format!("Steward credential of {}: {reason}", signature.signer));
            }
        }
        signers.push(VerifiedSigner {
            is_progenitor: progenitor.as_ref() == Some(&signature.signer),
            is_steward,
            signed: true,
            key: signature.signer,
        });
    }

    if gate_satisfied(&policy, joining_agent, &signers) {
        Ok(ValidateCallbackResult::Valid)
    } else {
        invalid("The membrane proof does not satisfy this group's join policy")
    }
}

/// Returns why `chain` does not prove that `holder` is a steward, if it does not.
fn steward_credential_problem(
    chain: &[StewardCredential],
    holder: &AgentPubKey,
    progenitor: Option<&AgentPubKey>,
) -> ExternResult<Option<String>> {
    let Some(progenitor) = progenitor else {
        return Ok(Some("this group has no progenitor, so it has no stewards".into()));
    };
    if let Err(reason) = check_steward_chain(chain, holder, progenitor) {
        return Ok(Some(reason));
    }
    verify_steward_chain(chain)
}

/// Reads the DNA properties. A DNA installed with no properties is an open
/// group, so it yields `None`.
pub fn join_properties(properties: SerializedBytes) -> Result<Option<GroupDnaProperties>, String> {
    if <()>::try_from(properties.clone()).is_ok() {
        return Ok(None);
    }
    GroupDnaProperties::try_from(properties)
        .map(Some)
        .map_err(|e| format!("Failed to deserialize DNA properties: {e}"))
}

/// Returns why `signature` does not approve the joining agent, if it does not.
fn signature_problem(
    signature: &JoinSignature,
    dna_hash: &DnaHash,
    join_bytes: &[u8],
    allow_delegated_invites: bool,
) -> ExternResult<Option<String>> {
    match &signature.delegation {
        None => {
            if verify_signature_raw(
                signature.signer.clone(),
                signature.signature.clone(),
                join_bytes.to_vec(),
            )? {
                Ok(None)
            } else {
                Ok(Some(format!("Invalid join signature from {}", signature.signer)))
            }
        }
        Some(delegation) => {
            if !allow_delegated_invites {
                return Ok(Some("This group does not accept delegated invites".into()));
            }
            if !verify_signature_raw(
                signature.signer.clone(),
                delegation.delegation_signature.clone(),
                delegation_payload_bytes(dna_hash, &delegation.invite_key),
            )? {
                return Ok(Some(format!(
                    "Invalid invite delegation signature from {}",
                    signature.signer
                )));
            }
            if !verify_signature_raw(
                delegation.invite_key.clone(),
                signature.signature.clone(),
                join_bytes.to_vec(),
            )? {
                return Ok(Some("Invalid join signature from the invite key".into()));
            }
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_properties_mean_no_join_policy() {
        let sb = SerializedBytes::try_from(()).unwrap();
        assert!(join_properties(sb).unwrap().is_none());
    }

    #[test]
    fn malformed_properties_are_an_error() {
        #[derive(Serialize, Deserialize, Debug, SerializedBytes)]
        struct NotGroupProperties(u32);
        let sb = SerializedBytes::try_from(NotGroupProperties(42)).unwrap();
        assert!(join_properties(sb).is_err());
    }
}
