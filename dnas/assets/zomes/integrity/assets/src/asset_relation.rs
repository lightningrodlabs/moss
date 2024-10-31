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

pub fn validate_create_asset_relation(
    _action: EntryCreationAction,
    _asset_relation: AssetRelation,
) -> ExternResult<ValidateCallbackResult> {
    /// TODO: add the appropriate validation rules
    Ok(ValidateCallbackResult::Valid)
}

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

pub fn validate_delete_asset_relation(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_asset_relation: AssetRelation,
) -> ExternResult<ValidateCallbackResult> {
    /// TODO: add the appropriate validation rules
    Ok(ValidateCallbackResult::Valid)
}
