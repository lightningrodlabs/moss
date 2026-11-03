use std::collections::HashSet;

use hdi::prelude::*;

use super::JoinGate;

/// Deepest allowed nesting of a policy tree, counting the leaf.
pub const MAX_POLICY_DEPTH: usize = 8;
/// Longest allowed key list or combinator list in a policy.
pub const MAX_POLICY_LIST: usize = 64;
/// Most signatures a membrane proof may carry.
pub const MAX_PROOF_SIGNATURES: usize = 16;

/// A signer whose approval of the joining agent has already been verified,
/// with the roles that validation resolved for it.
#[derive(Clone, Debug)]
pub struct VerifiedSigner {
    pub key: AgentPubKey,
    pub is_progenitor: bool,
    pub is_steward: bool,
    /// False for the joining agent's own steward permission, which approves the
    /// join as a steward without a signature, so it never counts as an
    /// `External` signature.
    pub signed: bool,
}

/// Rejects policies that can never be satisfied or that would make
/// validation expensive for every peer.
pub fn check_policy_shape(gate: &JoinGate, progenitor: Option<&AgentPubKey>) -> Result<(), String> {
    check_shape_at(gate, progenitor, 1)
}

fn check_shape_at(gate: &JoinGate, progenitor: Option<&AgentPubKey>, depth: usize) -> Result<(), String> {
    if depth > MAX_POLICY_DEPTH {
        return Err(format!("Join policy is nested deeper than {MAX_POLICY_DEPTH} levels"));
    }
    match gate {
        JoinGate::Progenitor | JoinGate::Steward => match progenitor {
            Some(_) => Ok(()),
            None => Err("Progenitor and Steward join gates need a progenitor in the DNA properties".into()),
        },
        JoinGate::External { keys, threshold } => {
            check_list_len(keys.len(), "External keys")?;
            if *threshold == 0 || *threshold as usize > keys.len() {
                return Err(format!(
                    "External threshold {threshold} must be between 1 and the number of keys ({})",
                    keys.len()
                ));
            }
            let distinct: HashSet<&AgentPubKeyB64> = keys.iter().collect();
            if distinct.len() != keys.len() {
                return Err("External keys contain duplicates".into());
            }
            Ok(())
        }
        JoinGate::AllowList { agents } => check_list_len(agents.len(), "AllowList agents"),
        JoinGate::AnyOf(gates) | JoinGate::AllOf(gates) => {
            if gates.is_empty() {
                return Err("AnyOf and AllOf join gates must not be empty".into());
            }
            check_list_len(gates.len(), "AnyOf/AllOf gates")?;
            gates
                .iter()
                .try_for_each(|g| check_shape_at(g, progenitor, depth + 1))
        }
    }
}

fn check_list_len(len: usize, what: &str) -> Result<(), String> {
    if len > MAX_POLICY_LIST {
        return Err(format!("{what} has {len} entries, more than {MAX_POLICY_LIST}"));
    }
    Ok(())
}

/// Whether `signers` admit `joining_agent` under `gate`.
pub fn gate_satisfied(gate: &JoinGate, joining_agent: &AgentPubKey, signers: &[VerifiedSigner]) -> bool {
    match gate {
        JoinGate::Progenitor => signers.iter().any(|s| s.is_progenitor),
        JoinGate::Steward => signers.iter().any(|s| s.is_steward),
        JoinGate::External { keys, threshold } => {
            let listed: HashSet<AgentPubKey> = keys.iter().cloned().map(AgentPubKey::from).collect();
            let signed: HashSet<&AgentPubKey> =
                signers
                .iter()
                .filter(|s| s.signed)
                .map(|s| &s.key)
                .filter(|k| listed.contains(*k))
                .collect();
            signed.len() >= *threshold as usize
        }
        JoinGate::AllowList { agents } => agents
            .iter()
            .any(|a| &AgentPubKey::from(a.clone()) == joining_agent),
        JoinGate::AnyOf(gates) => gates.iter().any(|g| gate_satisfied(g, joining_agent, signers)),
        JoinGate::AllOf(gates) => gates.iter().all(|g| gate_satisfied(g, joining_agent, signers)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> AgentPubKey {
        AgentPubKey::from_raw_32(vec![byte; 32])
    }
    fn b64(byte: u8) -> AgentPubKeyB64 {
        AgentPubKeyB64::from(key(byte))
    }
    fn signer(byte: u8, is_progenitor: bool, is_steward: bool) -> VerifiedSigner {
        VerifiedSigner { key: key(byte), is_progenitor, is_steward, signed: true }
    }
    fn progenitor() -> VerifiedSigner {
        signer(1, true, false)
    }
    fn steward() -> VerifiedSigner {
        signer(2, false, true)
    }
    fn joiner() -> AgentPubKey {
        key(99)
    }
    fn external_2_of_3() -> JoinGate {
        JoinGate::External { keys: vec![b64(10), b64(11), b64(12)], threshold: 2 }
    }

    #[test]
    fn progenitor_gate_needs_progenitor_signer() {
        assert!(gate_satisfied(&JoinGate::Progenitor, &joiner(), &[progenitor()]));
        assert!(!gate_satisfied(&JoinGate::Progenitor, &joiner(), &[steward()]));
        assert!(!gate_satisfied(&JoinGate::Progenitor, &joiner(), &[]));
    }

    #[test]
    fn steward_gate_rejects_progenitor_only() {
        assert!(!gate_satisfied(&JoinGate::Steward, &joiner(), &[progenitor()]));
        assert!(gate_satisfied(&JoinGate::Steward, &joiner(), &[steward()]));
    }

    #[test]
    fn either_accepts_progenitor_or_steward() {
        let gate = JoinGate::AnyOf(vec![JoinGate::Progenitor, JoinGate::Steward]);
        assert!(gate_satisfied(&gate, &joiner(), &[progenitor()]));
        assert!(gate_satisfied(&gate, &joiner(), &[steward()]));
        assert!(!gate_satisfied(&gate, &joiner(), &[signer(3, false, false)]));
    }

    #[test]
    fn both_requires_two_distinct_roles() {
        let gate = JoinGate::AllOf(vec![JoinGate::Progenitor, JoinGate::Steward]);
        assert!(!gate_satisfied(&gate, &joiner(), &[progenitor()]));
        assert!(!gate_satisfied(&gate, &joiner(), &[steward()]));
        assert!(gate_satisfied(&gate, &joiner(), &[progenitor(), steward()]));
    }

    #[test]
    fn external_threshold_counts_distinct_keys() {
        let gate = external_2_of_3();
        let one = signer(10, false, false);
        assert!(!gate_satisfied(&gate, &joiner(), &[one.clone()]));
        assert!(!gate_satisfied(&gate, &joiner(), &[one.clone(), one.clone()]));
        assert!(gate_satisfied(&gate, &joiner(), &[one, signer(11, false, false)]));
    }

    #[test]
    fn external_ignores_unlisted_signers() {
        let gate = external_2_of_3();
        let signers = [signer(10, false, false), signer(50, false, false), progenitor()];
        assert!(!gate_satisfied(&gate, &joiner(), &signers));
    }

    #[test]
    fn external_ignores_unsigned_entries() {
        let gate = JoinGate::External { keys: vec![b64(99)], threshold: 1 };
        let own_permission = VerifiedSigner { key: joiner(), is_progenitor: false, is_steward: true, signed: false };
        assert!(!gate_satisfied(&gate, &joiner(), &[own_permission]));
    }

    #[test]
    fn allow_list_needs_no_signature() {
        let gate = JoinGate::AllowList { agents: vec![b64(99)] };
        assert!(gate_satisfied(&gate, &joiner(), &[]));
        assert!(!gate_satisfied(&gate, &key(98), &[progenitor()]));
    }

    fn assert_shape_err(gate: JoinGate, progenitor: Option<&AgentPubKey>) {
        assert!(check_policy_shape(&gate, progenitor).is_err(), "expected error for {gate:?}");
    }

    #[test]
    fn shape_rejects_bad_thresholds() {
        let p = key(1);
        assert_shape_err(JoinGate::External { keys: vec![b64(10)], threshold: 0 }, Some(&p));
        assert_shape_err(JoinGate::External { keys: vec![b64(10)], threshold: 2 }, Some(&p));
    }

    #[test]
    fn shape_rejects_empty_combinators() {
        assert_shape_err(JoinGate::AnyOf(vec![]), Some(&key(1)));
        assert_shape_err(JoinGate::AllOf(vec![]), Some(&key(1)));
    }

    #[test]
    fn shape_rejects_progenitor_roles_without_progenitor() {
        assert_shape_err(JoinGate::Progenitor, None);
        assert_shape_err(JoinGate::Steward, None);
        assert_shape_err(JoinGate::AnyOf(vec![JoinGate::Steward]), None);
    }

    #[test]
    fn shape_rejects_duplicate_external_keys() {
        assert_shape_err(JoinGate::External { keys: vec![b64(10), b64(10)], threshold: 1 }, None);
    }

    #[test]
    fn shape_rejects_deep_nesting() {
        let mut gate = JoinGate::Progenitor;
        for _ in 0..MAX_POLICY_DEPTH {
            gate = JoinGate::AnyOf(vec![gate]);
        }
        assert_shape_err(gate, Some(&key(1)));
    }

    #[test]
    fn shape_rejects_long_lists() {
        let keys: Vec<AgentPubKeyB64> = (0..=MAX_POLICY_LIST as u8).map(b64).collect();
        assert_shape_err(JoinGate::AllowList { agents: keys.clone() }, None);
        assert_shape_err(JoinGate::External { keys, threshold: 1 }, None);
        let gates = vec![JoinGate::AllowList { agents: vec![b64(1)] }; MAX_POLICY_LIST + 1];
        assert_shape_err(JoinGate::AnyOf(gates), None);
    }

    #[test]
    fn shape_accepts_valid_nested_tree() {
        let gate = JoinGate::AnyOf(vec![
            JoinGate::AllOf(vec![JoinGate::Progenitor, JoinGate::Steward]),
            external_2_of_3(),
            JoinGate::AllowList { agents: vec![b64(20)] },
        ]);
        assert!(check_policy_shape(&gate, Some(&key(1))).is_ok());
    }
}
