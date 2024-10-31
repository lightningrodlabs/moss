use hdi::prelude::*;

#[derive(Serialize, Deserialize, SerializedBytes, Debug)]
pub struct LinkTagContent {
    pub tag: String,
    // action hash of the backlink. Used to efficiently delete the backlink
    // without having to do a get_links and filter by link targets.
    // This seems worth it since relationship tags may potentially be
    // used by many many different AssetRelation entries.
    pub backlink_action_hash: ActionHash,
}

pub fn validate_create_link_asset_relation_to_relationship_tags(
    _action: CreateLink,
    _base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // 1. Validate that the link tag is of the correct format
    let link_tag_content = match ExternIO::from(tag.0).decode::<LinkTagContent>() {
        Ok(c) => c,
        Err(e) => {
            return Ok(ValidateCallbackResult::Invalid(format!(
                "Link tag content format is invalid. Serialization error: {e}"
            )))
        }
    };

    // 2. Validate that the tag in the LinkTag content matches the tag that the link is pointing to
    let rt_entry_hash =
        target_address
            .into_entry_hash()
            .ok_or(wasm_error!(WasmErrorInner::Guest(
                "Link target of an AssetRelationToRelationshipTags link must be an entry hash."
                    .to_string()
            )))?;

    let rt_entry_hash_2 = relationship_tag_entry_hash(&link_tag_content.tag)?;

    if rt_entry_hash != rt_entry_hash_2 {
        return Ok(ValidateCallbackResult::Invalid(format!(
            "The relationship tag in the LinkTag is not matching the relationship tag that the link is pointing to."
        )));
    }

    Ok(ValidateCallbackResult::Valid)
}

pub fn validate_delete_link_asset_relation_to_relationship_tags(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}

pub fn relationship_tag_entry_hash(tag: &String) -> ExternResult<EntryHash> {
    let relationship_tag_path = Path::from(format!("relationship:{tag}"));
    relationship_tag_path.path_entry_hash()
}
