use core::str;

use assets_integrity::*;
use hdk::prelude::*;

#[derive(Serialize, Deserialize, Debug)]
pub struct AssetRelationAndHash {
    pub src_wal: WAL,
    pub dst_wal: WAL,
    pub relation_hash: EntryHash,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AssetRelationWithTags {
    pub src_wal: WAL,
    pub dst_wal: WAL,
    pub tags: Vec<String>,
    pub relation_hash: EntryHash,
}

#[derive(Serialize, Deserialize, SerializedBytes, Debug)]
pub struct RelateAssetsInput {
    pub src_wal: WAL,
    pub dst_wal: WAL,
    pub tags: Vec<String>,
}

#[hdk_extern]
pub fn add_asset_relation(input: RelateAssetsInput) -> ExternResult<AssetRelationWithTags> {
    let asset_relation = AssetRelation {
        src_wal: input.src_wal.clone(),
        dst_wal: input.dst_wal.clone(),
    };
    create_entry(&EntryTypes::AssetRelation(asset_relation.clone()))?;
    let relation_hash = hash_entry(asset_relation)?;

    // 2. Add tags to the asset relation entry hash
    add_tags_to_asset_relation(AddTagsToAssetRelationInput {
        relation_hash: relation_hash.clone(),
        tags: input.tags.clone(),
    })?;

    // 3. Create links from the associated WALs with the WAL of the opposite end of the link in the tag
    let src_wal_entry_hash = hash_entry(input.src_wal.clone())?;
    create_link(
        src_wal_entry_hash,
        relation_hash.clone(),
        LinkTypes::SrcWalToAssetRelations,
        (),
    )?;
    let dst_wal_entry_hash = hash_entry(input.dst_wal.clone())?;
    create_link(
        dst_wal_entry_hash,
        relation_hash.clone(),
        LinkTypes::DstWalToAssetRelations,
        (),
    )?;

    Ok(AssetRelationWithTags {
        src_wal: input.src_wal,
        dst_wal: input.dst_wal,
        tags: input.tags,
        relation_hash,
    })
}

#[derive(Serialize, Deserialize, SerializedBytes, Debug)]
pub struct AddTagsToAssetRelationInput {
    pub relation_hash: EntryHash,
    pub tags: Vec<String>,
}

/// Adds tags to an asset relation
#[hdk_extern]
pub fn add_tags_to_asset_relation(input: AddTagsToAssetRelationInput) -> ExternResult<()> {
    // 1. Derive the hash of the virtual entry
    for tag in input.tags {
        let rt_entry_hash = relationship_tag_entry_hash(&tag)?;
        let backlink_action_hash = create_link(
            rt_entry_hash.clone(),
            input.relation_hash.clone(),
            LinkTypes::RelationshipTagToAssetRelation,
            (),
        )?;
        let link_tag_content = LinkTagContent {
            tag,
            backlink_action_hash,
        };
        let link_tag_content_serialized = ExternIO::encode(link_tag_content)
            .map_err(|e| {
                wasm_error!(WasmErrorInner::Guest(format!(
                    "Failed to encode link tag content: {e}"
                )))
            })?
            .into_vec();
        create_link(
            input.relation_hash.clone(),
            rt_entry_hash,
            LinkTypes::AssetRelationToRelationshipTags,
            LinkTag(link_tag_content_serialized),
        )?;
    }
    Ok(())
}

#[hdk_extern]
pub fn remove_asset_relation(asset_relation: AssetRelation) -> ExternResult<()> {
    let relation_hash = hash_asset_relation(
        asset_relation.src_wal.clone(),
        asset_relation.dst_wal.clone(),
    )?;

    // 0. This operation does not delete the Entry since there is no point in doing so.
    // It would only create an unnecessary delete action but an AssetRelation entry
    // is never being addressed by its ActionHash anyway.

    // 1. remove all tags
    remove_all_tags_from_asset_relation(relation_hash.clone())?;

    // 2. Remove all links from the source WAL
    let src_wal_entry_hash = hash_entry(asset_relation.src_wal.clone())?;
    let src_wal_links = get_links(
        GetLinksInputBuilder::try_new(src_wal_entry_hash, LinkTypes::SrcWalToAssetRelations)?
            .build(),
    )?;
    for link in src_wal_links {
        if link.target.clone().into_hash() == relation_hash.clone().into() {
            delete_link(link.create_link_hash)?;
        }
    }

    // 2. Remove all links from the destination WAL
    let dst_wal_entry_hash = hash_entry(asset_relation.dst_wal.clone())?;
    let dst_wal_links = get_links(
        GetLinksInputBuilder::try_new(dst_wal_entry_hash, LinkTypes::DstWalToAssetRelations)?
            .build(),
    )?;
    for link in dst_wal_links {
        if link.target.clone().into_hash() == relation_hash.clone().into() {
            delete_link(link.create_link_hash)?;
        }
    }

    Ok(())
}

pub fn remove_all_tags_from_asset_relation(relation_hash: EntryHash) -> ExternResult<()> {
    let links = get_links(
        GetLinksInputBuilder::try_new(
            relation_hash.clone(),
            LinkTypes::AssetRelationToRelationshipTags,
        )?
        .build(),
    )?;
    for link in links {
        let link_tag_content = ExternIO::from(link.tag.0)
            .decode::<LinkTagContent>()
            .map_err(|e| {
                wasm_error!(WasmErrorInner::Guest(format!(
                    "Failed to decode link tag content: {e}"
                )))
            })?;
        delete_link(link.create_link_hash)?;
        delete_link(link_tag_content.backlink_action_hash)?;
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RemoveTagsFromAssetRelationInput {
    pub relation_hash: EntryHash,
    pub tags: Vec<String>,
}

#[hdk_extern]
pub fn remove_tags_from_asset_relation(
    input: RemoveTagsFromAssetRelationInput,
) -> ExternResult<()> {
    let links = get_links(
        GetLinksInputBuilder::try_new(
            input.relation_hash,
            LinkTypes::AssetRelationToRelationshipTags,
        )?
        .build(),
    )?;
    for link in links {
        match ExternIO::from(link.tag.0)
            .decode::<LinkTagContent>()
            .map_err(|e| {
                wasm_error!(WasmErrorInner::Guest(format!(
                    "Failed to decode link tag content: {e}"
                )))
            }) {
            Ok(link_tag_content) => {
                if input.tags.contains(&link_tag_content.tag) {
                    delete_link(link.create_link_hash)?;
                    delete_link(link_tag_content.backlink_action_hash)?;
                }
            }
            Err(e) => {
                eprintln!("WARNING: Failed to retrieve String from link tag in zome 'remove_tags_from_asset_relation': {e}", );
            }
        }
    }
    Ok(())
}

#[hdk_extern]
pub fn get_outgoing_asset_relations_with_tags(
    src_wal: WAL,
) -> ExternResult<Vec<AssetRelationWithTags>> {
    let asset_relations = get_outgoing_asset_relations(src_wal)?;
    let mut asset_relations_with_tags: Vec<AssetRelationWithTags> = Vec::new();
    for asset_relation in asset_relations {
        let links = get_links(
            GetLinksInputBuilder::try_new(
                asset_relation.relation_hash.clone(),
                LinkTypes::AssetRelationToRelationshipTags,
            )?
            .build(),
        )?;
        let tags = links
            .iter()
            .map(|l| {
                ExternIO::from(l.clone().tag.0)
                    .decode::<LinkTagContent>()
                    .ok()
            })
            .filter_map(|c| c)
            .map(|c| c.tag)
            .collect::<Vec<String>>();
        asset_relations_with_tags.push(AssetRelationWithTags {
            src_wal: asset_relation.src_wal,
            dst_wal: asset_relation.dst_wal,
            tags,
            relation_hash: asset_relation.relation_hash,
        });
    }
    Ok(asset_relations_with_tags)
}

#[hdk_extern]
pub fn get_outgoing_asset_relations(src_wal: WAL) -> ExternResult<Vec<AssetRelationAndHash>> {
    let src_wal_entry_hash = hash_entry(src_wal)?;
    let src_wal_links = get_links(
        GetLinksInputBuilder::try_new(src_wal_entry_hash, LinkTypes::SrcWalToAssetRelations)?
            .build(),
    )?;
    let get_input: Vec<GetInput> = src_wal_links
        .into_iter()
        .map(|link| {
            Ok(GetInput::new(
                link.target
                    .into_entry_hash()
                    .ok_or(wasm_error!(WasmErrorInner::Guest(
                        "Link target is not an entry hash".to_string()
                    )))?
                    .into(),
                GetOptions::default(),
            ))
        })
        .collect::<ExternResult<Vec<GetInput>>>()?;
    let records = HDK.with(|hdk| hdk.borrow().get(get_input))?;
    let mut asset_relations: Vec<AssetRelationAndHash> = Vec::new();
    for maybe_record in records {
        if let Some(record) = maybe_record {
            let maybe_entry = record
                .entry()
                .to_app_option::<AssetRelation>()
                .map_err(|e| {
                    wasm_error!(WasmErrorInner::Guest(format!(
                        "Failed to deserialize entry to AssetRelation: {}",
                        e
                    )))
                })?;
            if let Some(asset_relation) = maybe_entry {
                let asset_relation_and_hash = AssetRelationAndHash {
                    src_wal: asset_relation.src_wal,
                    dst_wal: asset_relation.dst_wal,
                    relation_hash: record
                        .action()
                        .entry_hash()
                        .ok_or(wasm_error!(WasmErrorInner::Guest(
                            "AssetRelation record has no entry hash".into()
                        )))?
                        .to_owned(),
                };
                asset_relations.push(asset_relation_and_hash)
            }
        }
    }
    Ok(asset_relations)
}

#[hdk_extern]
pub fn get_incoming_asset_relations_with_tags(
    dst_wal: WAL,
) -> ExternResult<Vec<AssetRelationWithTags>> {
    let asset_relations = get_incoming_asset_relations(dst_wal)?;
    let mut asset_relations_with_tags: Vec<AssetRelationWithTags> = Vec::new();
    for asset_relation in asset_relations {
        let links = get_links(
            GetLinksInputBuilder::try_new(
                asset_relation.relation_hash.clone(),
                LinkTypes::AssetRelationToRelationshipTags,
            )?
            .build(),
        )?;
        let tags = links
            .iter()
            .map(|l| {
                ExternIO::from(l.clone().tag.0)
                    .decode::<LinkTagContent>()
                    .ok()
            })
            .filter_map(|c| c)
            .map(|c| c.tag)
            .collect::<Vec<String>>();
        asset_relations_with_tags.push(AssetRelationWithTags {
            src_wal: asset_relation.src_wal,
            dst_wal: asset_relation.dst_wal,
            tags,
            relation_hash: asset_relation.relation_hash,
        });
    }
    Ok(asset_relations_with_tags)
}

#[hdk_extern]
pub fn get_incoming_asset_relations(dst_wal: WAL) -> ExternResult<Vec<AssetRelationAndHash>> {
    let dst_wal_entry_hash = hash_entry(dst_wal)?;
    let dst_wal_links = get_links(
        GetLinksInputBuilder::try_new(dst_wal_entry_hash, LinkTypes::DstWalToAssetRelations)?
            .build(),
    )?;
    let get_input: Vec<GetInput> = dst_wal_links
        .into_iter()
        .map(|link| {
            Ok(GetInput::new(
                link.target
                    .into_entry_hash()
                    .ok_or(wasm_error!(WasmErrorInner::Guest(
                        "Link target is not an entry hash".to_string()
                    )))?
                    .into(),
                GetOptions::default(),
            ))
        })
        .collect::<ExternResult<Vec<GetInput>>>()?;
    let records = HDK.with(|hdk| hdk.borrow().get(get_input))?;
    let mut asset_relations: Vec<AssetRelationAndHash> = Vec::new();
    for maybe_record in records {
        if let Some(record) = maybe_record {
            let maybe_entry = record
                .entry()
                .to_app_option::<AssetRelation>()
                .map_err(|e| {
                    wasm_error!(WasmErrorInner::Guest(format!(
                        "Failed to deserialize entry to AssetRelation: {}",
                        e
                    )))
                })?;
            if let Some(asset_relation) = maybe_entry {
                let asset_relation_and_hash = AssetRelationAndHash {
                    src_wal: asset_relation.src_wal,
                    dst_wal: asset_relation.dst_wal,
                    relation_hash: record
                        .action()
                        .entry_hash()
                        .ok_or(wasm_error!(WasmErrorInner::Guest(
                            "AssetRelation record has no entry hash".into()
                        )))?
                        .to_owned(),
                };
                asset_relations.push(asset_relation_and_hash)
            }
        }
    }
    Ok(asset_relations)
}

#[hdk_extern]
pub fn get_asset_relations_for_relationship_tag(
    tag: String,
) -> ExternResult<Vec<AssetRelationAndHash>> {
    let rt_entry_hash = relationship_tag_entry_hash(&tag)?;
    let links = get_links(
        GetLinksInputBuilder::try_new(rt_entry_hash, LinkTypes::RelationshipTagToAssetRelation)?
            .build(),
    )?;
    let get_input: Vec<GetInput> = links
        .into_iter()
        .map(|link| {
            Ok(GetInput::new(
                link.target
                    .into_entry_hash()
                    .ok_or(wasm_error!(WasmErrorInner::Guest(
                        "Link target is not an entry hash".to_string()
                    )))?
                    .into(),
                GetOptions::default(),
            ))
        })
        .collect::<ExternResult<Vec<GetInput>>>()?;
    let records = HDK.with(|hdk| hdk.borrow().get(get_input))?;
    let mut asset_relations: Vec<AssetRelationAndHash> = Vec::new();
    for maybe_record in records {
        if let Some(record) = maybe_record {
            let maybe_entry = record
                .entry()
                .to_app_option::<AssetRelation>()
                .map_err(|e| {
                    wasm_error!(WasmErrorInner::Guest(format!(
                        "Failed to deserialize entry to AssetRelation: {}",
                        e
                    )))
                })?;
            if let Some(asset_relation) = maybe_entry {
                let asset_relation_and_hash = AssetRelationAndHash {
                    src_wal: asset_relation.src_wal,
                    dst_wal: asset_relation.dst_wal,
                    relation_hash: record
                        .action()
                        .entry_hash()
                        .ok_or(wasm_error!(WasmErrorInner::Guest(
                            "AssetRelation record has no entry hash".into()
                        )))?
                        .to_owned(),
                };
                asset_relations.push(asset_relation_and_hash)
            }
        }
    }
    Ok(asset_relations)
}

fn hash_asset_relation(src_wal: WAL, dst_wal: WAL) -> ExternResult<EntryHash> {
    let asset_relation = AssetRelation {
        src_wal: src_wal.clone(),
        dst_wal: dst_wal.clone(),
    };
    hash_entry(asset_relation)
}
