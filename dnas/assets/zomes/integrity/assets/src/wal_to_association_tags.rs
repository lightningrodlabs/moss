use hdi::prelude::*;

pub fn validate_create_link_wal_to_association_tags(
    _action: CreateLink,
    _base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // 1. Validate that tag is of the correct format
    let link_tag_content = match std::str::from_utf8(&tag.0) {
        Ok(c) => c.to_string(),
        Err(e) => {
            return Ok(ValidateCallbackResult::Invalid(format!(
                "Link tag content format is invalid. Serialization error: {e}"
            )))
        }
    };

    // 2. Validate that the tag in the LinkTag content matches the tag that the link is pointing to
    let at_entry_hash =
        target_address
            .into_entry_hash()
            .ok_or(wasm_error!(WasmErrorInner::Guest(
                "Link target of a WalToAssociationTag link must be an entry hash.".to_string()
            )))?;

    let at_entry_hash_2 = association_tag_entry_hash(&link_tag_content)?;

    if at_entry_hash != at_entry_hash_2 {
        return Ok(ValidateCallbackResult::Invalid(format!(
            "association tag in the LinkTag is not matching the association tag that the link is pointing to."
        )));
    }
    Ok(ValidateCallbackResult::Valid)
}

pub fn validate_delete_link_wal_to_association_tags(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}

pub fn validate_create_link_association_tag_to_wals(
    _action: CreateLink,
    _base_address: AnyLinkableHash,
    _target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}

pub fn validate_delete_link_association_tag_to_wals(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}

pub fn association_tag_entry_hash(tag: &String) -> ExternResult<EntryHash> {
    let relationship_tag_path = Path::from(format!("association:{tag}"));
    relationship_tag_path.path_entry_hash()
}
