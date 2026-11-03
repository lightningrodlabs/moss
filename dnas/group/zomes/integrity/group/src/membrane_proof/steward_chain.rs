use hdi::prelude::*;

use crate::{StewardPermission, UnitEntryTypes};

/// Longest allowed chain of steward permissions from a steward back to the
/// progenitor.
pub const MAX_STEWARD_CHAIN: usize = 4;

/// One signed `StewardPermission` create record, carried in a membrane proof
/// so validation can check steward standing without fetching from the DHT.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct StewardCredential {
    pub action: Action,
    pub signature: Signature,
    pub permission: StewardPermission,
}

/// Checks that `chain` proves `holder` is a steward with a non-expiring
/// permission: each permission is issued by the holder of the next one, and
/// the last one is issued by the progenitor. Signatures and entry hashes are
/// checked separately by `verify_steward_chain`.
pub fn check_steward_chain(
    chain: &[StewardCredential],
    holder: &AgentPubKey,
    progenitor: &AgentPubKey,
) -> Result<(), String> {
    if chain.is_empty() {
        return Err("A steward credential needs at least one permission".into());
    }
    if chain.len() > MAX_STEWARD_CHAIN {
        return Err(format!(
            "A steward credential has more than {MAX_STEWARD_CHAIN} permissions"
        ));
    }
    let mut expected_holder = holder;
    for credential in chain {
        if !matches!(credential.action.data, ActionData::Create(_)) {
            return Err("A steward credential must contain Create actions".into());
        }
        let permission = &credential.permission;
        if &permission.for_agent != expected_holder {
            return Err("A steward credential's permissions do not link up".into());
        }
        if permission.expiry.is_some() {
            return Err("Expiring steward permissions cannot admit members".into());
        }
        if credential.action.author() == &permission.for_agent {
            return Err("A steward permission cannot be issued for oneself".into());
        }
        expected_holder = credential.action.author();
    }
    if expected_holder != progenitor {
        return Err("A steward credential must start with a permission issued by the progenitor".into());
    }
    Ok(())
}

/// Checks the signature and entry of every credential in `chain`. Returns why
/// the chain is invalid, if it is.
pub fn verify_steward_chain(chain: &[StewardCredential]) -> ExternResult<Option<String>> {
    let permission_type = EntryType::try_from(UnitEntryTypes::StewardPermission)?;
    for credential in chain {
        let ActionData::Create(create) = &credential.action.data else {
            return Ok(Some("A steward credential must contain Create actions".into()));
        };
        if create.entry_type != permission_type {
            return Ok(Some("A steward credential action does not create a StewardPermission".into()));
        }
        if create.entry_hash != hash_entry(&credential.permission)? {
            return Ok(Some("A steward credential's permission does not match its action".into()));
        }
        if !verify_signature(
            credential.action.author().clone(),
            credential.signature.clone(),
            &credential.action,
        )? {
            return Ok(Some("A steward credential has an invalid signature".into()));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> AgentPubKey {
        AgentPubKey::from_raw_32(vec![byte; 32])
    }

    const PROGENITOR: u8 = 1;

    /// A credential whose permission `author` issued for `holder`.
    fn link(author: u8, holder: u8, expiry: Option<Timestamp>) -> StewardCredential {
        StewardCredential {
            action: Action {
                header: ActionHeader {
                    author: key(author),
                    timestamp: Timestamp(0),
                    action_seq: 5,
                    prev_action: Some(ActionHash::from_raw_32(vec![9; 32])),
                },
                data: ActionData::Create(CreateData {
                    entry_type: EntryType::AgentPubKey,
                    entry_hash: EntryHash::from_raw_32(vec![8; 32]),
                }),
            },
            signature: Signature::from([0u8; 64]),
            permission: StewardPermission { permission_hash: None, for_agent: key(holder), expiry },
        }
    }

    #[test]
    fn single_link_issued_by_progenitor_is_valid() {
        let chain = [link(PROGENITOR, 2, None)];
        assert!(check_steward_chain(&chain, &key(2), &key(PROGENITOR)).is_ok());
    }

    #[test]
    fn chain_through_another_steward_is_valid() {
        let chain = [link(2, 3, None), link(PROGENITOR, 2, None)];
        assert!(check_steward_chain(&chain, &key(3), &key(PROGENITOR)).is_ok());
    }

    #[test]
    fn empty_chain_is_rejected() {
        assert!(check_steward_chain(&[], &key(2), &key(PROGENITOR)).is_err());
    }

    #[test]
    fn chain_for_another_holder_is_rejected() {
        let chain = [link(PROGENITOR, 2, None)];
        assert!(check_steward_chain(&chain, &key(3), &key(PROGENITOR)).is_err());
    }

    #[test]
    fn chain_not_rooted_at_progenitor_is_rejected() {
        let chain = [link(7, 2, None)];
        assert!(check_steward_chain(&chain, &key(2), &key(PROGENITOR)).is_err());
    }

    #[test]
    fn broken_link_is_rejected() {
        // Link 0 was issued by 4, but link 1 is a permission for 2.
        let chain = [link(4, 3, None), link(PROGENITOR, 2, None)];
        assert!(check_steward_chain(&chain, &key(3), &key(PROGENITOR)).is_err());
    }

    #[test]
    fn expiring_permission_anywhere_is_rejected() {
        let expiring = Some(Timestamp(i64::MAX));
        let leaf = [link(2, 3, expiring), link(PROGENITOR, 2, None)];
        assert!(check_steward_chain(&leaf, &key(3), &key(PROGENITOR)).is_err());
        let root = [link(2, 3, None), link(PROGENITOR, 2, expiring)];
        assert!(check_steward_chain(&root, &key(3), &key(PROGENITOR)).is_err());
    }

    #[test]
    fn self_issued_permission_is_rejected() {
        let chain = [link(2, 2, None), link(PROGENITOR, 2, None)];
        assert!(check_steward_chain(&chain, &key(2), &key(PROGENITOR)).is_err());
    }

    #[test]
    fn non_create_action_is_rejected() {
        let mut credential = link(PROGENITOR, 2, None);
        credential.action.data = ActionData::Dna(DnaData { dna_hash: DnaHash::from_raw_32(vec![1; 32]) });
        assert!(check_steward_chain(&[credential], &key(2), &key(PROGENITOR)).is_err());
    }

    #[test]
    fn chain_longer_than_limit_is_rejected() {
        let mut chain: Vec<StewardCredential> = (0..MAX_STEWARD_CHAIN as u8)
            .map(|i| link(11 + i, 10 + i, None))
            .collect();
        chain.push(link(PROGENITOR, 10 + MAX_STEWARD_CHAIN as u8, None));
        assert_eq!(chain.len(), MAX_STEWARD_CHAIN + 1);
        assert!(check_steward_chain(&chain, &key(10), &key(PROGENITOR)).is_err());
        assert!(check_steward_chain(&chain[1..], &key(11), &key(PROGENITOR)).is_ok());
    }
}
