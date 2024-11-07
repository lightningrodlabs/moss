use std::collections::BTreeMap;

use hdi::prelude::*;

use crate::Applet;

/// A copy of an applet instance to store on the local source chain
#[hdk_entry_helper]
#[derive(Clone)]
pub struct AppletEntryPrivate {
    pub public_entry_hash: EntryHash,
    pub applet: Applet,
    pub applet_pubkey: AgentPubKey,
    /// Optionally, the membrane proofs used at install time may be stored in the
    /// private entry here to reuse it in cloned cells that want to reuse the
    /// same membrane proof
    pub membrane_proofs: Option<BTreeMap<String, SerializedBytes>>,
}
pub fn validate_create_applet_private(
    _action: EntryCreationAction,
    _applet_private: AppletEntryPrivate,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_private_applet(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_applet_private: AppletEntryPrivate,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "A AppletEntryPrivate cannot be deleted",
    )))
}
