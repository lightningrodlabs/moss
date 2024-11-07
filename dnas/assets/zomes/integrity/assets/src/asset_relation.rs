use hdi::prelude::*;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HRL(DnaHash, AnyDhtHash);

#[hdk_entry_helper]
#[derive(Clone)]
pub struct WAL {
    pub hrl: HRL,
    pub context: Option<Vec<u8>>,
}

#[derive(Clone)]
#[hdk_entry_helper]
pub struct AssetRelation {
    pub src_wal: WAL,
    pub dst_wal: WAL,
}

/// Anyone can create an asset relation
pub fn validate_create_asset_relation(
    _action: EntryCreationAction,
    _asset_relation: AssetRelation,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}

/// Updating asset relation is meaningless and therefore not allowed
pub fn validate_update_asset_relation(
    _action: Update,
    _asset_relation: AssetRelation,
    _original_action: EntryCreationAction,
    _original_asset_relation: AssetRelation,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(
        "Asset Relations cannot be updated".to_string(),
    ))
}

/// Anyone can delete an asset relation. Restrictions would need to be enorced at the UI level
pub fn validate_delete_asset_relation(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_asset_relation: AssetRelation,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
