use hdi::prelude::*;

use crate::StewardPermission;

#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct StewardPermissionClaim {
    pub permission_hash: ActionHash,
    pub permission: StewardPermission,
}
pub fn validate_create_steward_permission_claim(
    _action: Action,
    _claim: StewardPermissionClaim,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_steward_permission_claim(
    _action: Action,
    _original_action: Action,
    _original_claim: StewardPermissionClaim,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "A StewardPermissionClaim cannot be deleted",
    )))
}
