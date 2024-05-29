use hdi::prelude::*;

use crate::Applet;

/// A copy of an applet instance to store on the local source chain
#[hdk_entry_helper]
#[derive(Clone)]
pub struct PrivateAppletEntry {
    pub public_entry_hash: EntryHash,
    pub applet: Applet,
    pub applet_pubkey: AgentPubKey,
}
pub fn validate_create_applet_private(
    _action: EntryCreationAction,
    _applet_private: PrivateAppletEntry,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_private_applet(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_applet_private: PrivateAppletEntry,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "A PrivateAppletEntry cannot be deleted",
    )))
}
