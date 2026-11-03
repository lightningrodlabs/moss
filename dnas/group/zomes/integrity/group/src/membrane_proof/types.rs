use hdi::prelude::*;

/// A gate that decides whether an agent may join the group. Gates compose
/// through `AnyOf` and `AllOf`, so new combinations need no new variants.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(tag = "type", content = "content")]
pub enum JoinGate {
    /// Signed by the progenitor named in the DNA properties.
    Progenitor,
    /// Signed by a holder of a non-expiring `StewardPermission`.
    Steward,
    /// Signed by at least `threshold` distinct keys from `keys`.
    External {
        keys: Vec<AgentPubKeyB64>,
        threshold: u32,
    },
    /// The joining agent is listed. No signature is needed.
    AllowList { agents: Vec<AgentPubKeyB64> },
    AnyOf(Vec<JoinGate>),
    AllOf(Vec<JoinGate>),
}

/// The membrane proof a joining agent presents at genesis.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq, SerializedBytes)]
pub struct GroupMembraneProof {
    pub signatures: Vec<JoinSignature>,
}

/// One signer's approval of a joining agent.
///
/// Without `delegation`, `signature` is the signer's signature over the join
/// bytes. With `delegation`, `signature` is the invite key's signature over the
/// join bytes, and the delegation carries the signer's signature over the
/// invite key.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct JoinSignature {
    pub signer: AgentPubKey,
    pub steward_permission_hash: Option<ActionHash>,
    pub signature: Signature,
    pub delegation: Option<Delegation>,
}

/// A signer's approval of a one-time invite key, used by offline invite links.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct Delegation {
    pub invite_key: AgentPubKey,
    pub delegation_signature: Signature,
}

/// Domain tag for signatures over a joining agent.
pub const JOIN_DOMAIN: &[u8] = b"moss-group-join-v1";
/// Domain tag for signatures over an invite key.
pub const JOIN_DELEGATE_DOMAIN: &[u8] = b"moss-group-invite-v1";

/// The bytes a signer (or invite key) signs to admit `joining_agent` to the
/// group with `dna_hash`. Plain concatenation, so any language can build them.
pub fn join_payload_bytes(dna_hash: &DnaHash, joining_agent: &AgentPubKey) -> Vec<u8> {
    domain_bytes(JOIN_DOMAIN, dna_hash, joining_agent)
}

/// The bytes a signer signs to approve `invite_key` for the group with `dna_hash`.
pub fn delegation_payload_bytes(dna_hash: &DnaHash, invite_key: &AgentPubKey) -> Vec<u8> {
    domain_bytes(JOIN_DELEGATE_DOMAIN, dna_hash, invite_key)
}

fn domain_bytes(domain: &[u8], dna_hash: &DnaHash, key: &AgentPubKey) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(domain.len() + 39 + 39);
    bytes.extend_from_slice(domain);
    bytes.extend_from_slice(dna_hash.get_raw_39());
    bytes.extend_from_slice(key.get_raw_39());
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::GroupDnaProperties;

    #[derive(Serialize, Deserialize, Debug, SerializedBytes)]
    struct PropertiesWrittenByCurrentMoss {
        progenitor: Option<AgentPubKeyB64>,
    }

    fn agent(byte: u8) -> AgentPubKey {
        AgentPubKey::from_raw_32(vec![byte; 32])
    }

    #[test]
    fn properties_without_new_fields_deserialize_to_defaults() {
        let sb = SerializedBytes::try_from(PropertiesWrittenByCurrentMoss { progenitor: None }).unwrap();
        let props = GroupDnaProperties::try_from(sb).unwrap();
        assert!(props.progenitor.is_none());
        assert!(props.join_policy.is_none());
        assert!(!props.allow_delegated_invites);
    }

    #[test]
    fn join_gate_round_trips() {
        let gate = JoinGate::AllOf(vec![
            JoinGate::Progenitor,
            JoinGate::External {
                keys: vec![AgentPubKeyB64::from(agent(7))],
                threshold: 1,
            },
        ]);
        let props = GroupDnaProperties {
            progenitor: None,
            join_policy: Some(gate.clone()),
            allow_delegated_invites: true,
        };
        let sb = SerializedBytes::try_from(props).unwrap();
        let decoded = GroupDnaProperties::try_from(sb).unwrap();
        assert_eq!(decoded.join_policy, Some(gate));
        assert!(decoded.allow_delegated_invites);
    }

    #[test]
    fn membrane_proof_round_trips() {
        let proof = GroupMembraneProof {
            signatures: vec![JoinSignature {
                signer: agent(4),
                steward_permission_hash: None,
                signature: Signature::from([9u8; 64]),
                delegation: Some(Delegation {
                    invite_key: agent(5),
                    delegation_signature: Signature::from([8u8; 64]),
                }),
            }],
        };
        let sb = SerializedBytes::try_from(proof.clone()).unwrap();
        assert_eq!(GroupMembraneProof::try_from(sb).unwrap(), proof);
    }

    // Test vector shared with the TypeScript signer in Moss:
    // JOIN_DOMAIN ‖ DnaHash::from_raw_32([1;32]) ‖ AgentPubKey::from_raw_32([2;32])
    #[test]
    fn payload_bytes_test_vector() {
        let dna = DnaHash::from_raw_32(vec![1; 32]);
        let joiner = agent(2);
        let bytes = join_payload_bytes(&dna, &joiner);
        assert_eq!(bytes.len(), 18 + 39 + 39);
        assert_eq!(&bytes[..18], JOIN_DOMAIN);
        assert_eq!(&bytes[18..57], dna.get_raw_39());
        assert_eq!(&bytes[57..], joiner.get_raw_39());
        assert_eq!(
            hex(&bytes),
            "6d6f73732d67726f75702d6a6f696e2d7631842d2401010101010101010101010101010101010101010101010101010101010101017ecfcebe842024020202020202020202020202020202020202020202020202020202020202020220493dfd"
        );
    }

    // Test vector shared with the TypeScript signer in Moss:
    // JOIN_DELEGATE_DOMAIN ‖ DnaHash::from_raw_32([1;32]) ‖ AgentPubKey::from_raw_32([3;32])
    #[test]
    fn delegation_bytes_test_vector() {
        let dna = DnaHash::from_raw_32(vec![1; 32]);
        let invite_key = agent(3);
        let bytes = delegation_payload_bytes(&dna, &invite_key);
        assert_eq!(bytes.len(), 20 + 39 + 39);
        assert_eq!(&bytes[..20], JOIN_DELEGATE_DOMAIN);
        assert_eq!(&bytes[20..59], dna.get_raw_39());
        assert_eq!(&bytes[59..], invite_key.get_raw_39());
        assert_eq!(
            hex(&bytes),
            "6d6f73732d67726f75702d696e766974652d7631842d2401010101010101010101010101010101010101010101010101010101010101017ecfcebe84202403030303030303030303030303030303030303030303030303030303030303033f5da112"
        );
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
