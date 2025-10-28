use core::str;

use assets_integrity::*;
use hdk::prelude::*;
use itertools::Itertools;
use moss_helpers::ZomeFnInput;

use crate::{associations::get_tags_for_asset, Signal};

#[derive(Serialize, Deserialize, Debug)]
pub struct AssetRelationAndHash {
    pub src_wal: WAL,
    pub dst_wal: WAL,
    pub relation_hash: EntryHash,
    pub created_at: Timestamp,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AssetRelationWithTags {
    pub src_wal: WAL,
    pub dst_wal: WAL,
    pub tags: Vec<String>,
    pub relation_hash: EntryHash,
    pub created_at: Timestamp,
}

#[derive(Serialize, Deserialize, SerializedBytes, Debug)]
pub struct RelateAssetsInput {
    pub src_wal: WAL,
    pub dst_wal: WAL,
    pub tags: Vec<String>,
}

/// Note that the WAL's context is an Option<Vec<u8>> and therefore needs to have been
/// encoded into that format client-side because a WAL in general can be any arbitrary
/// javascript object
#[hdk_extern]
pub fn add_asset_relation(
    input: ZomeFnInput<RelateAssetsInput>,
) -> ExternResult<AssetRelationWithTags> {
    let asset_relation = AssetRelation {
        src_wal: input.input.src_wal.clone(),
        dst_wal: input.input.dst_wal.clone(),
    };

    // 1. Create entry and add it to the ALL_ASSET_RELATIONS_ANCHOR if no entry exists yet
    let relation_hash = hash_entry(asset_relation.clone())?;
    let record = match get(relation_hash.clone(), input.get_options()) {
        Ok(Some(r)) => r,
        _ => {
            let action_hash = create_entry(&EntryTypes::AssetRelation(asset_relation.clone()))?;
            let path = Path::from(ALL_ASSET_RELATIONS_ANCHOR);
            create_link(
                path.path_entry_hash()?,
                relation_hash.clone(),
                LinkTypes::AllAssetRelations,
                (),
            )?;
            get(action_hash, GetOptions::default())?.ok_or(wasm_error!(WasmErrorInner::Guest(
                format!("Failed to get the record that was just created.")
            )))?
        }
    };

    // 2. Add tags to the asset relation entry hash
    add_tags_to_asset_relation(ZomeFnInput::new(
        AddTagsToAssetRelationInput {
            relation_hash: relation_hash.clone(),
            tags: input.input.tags.clone(),
        },
        input.local,
    ))?;

    // 3. Create links from the associated WALs with the WAL of the opposite end of the link in the tag
    let src_wal_entry_hash = hash_entry(input.input.src_wal.clone())?;
    create_link(
        src_wal_entry_hash,
        relation_hash.clone(),
        LinkTypes::SrcWalToAssetRelations,
        (),
    )?;
    let dst_wal_entry_hash = hash_entry(input.input.dst_wal.clone())?;
    create_link(
        dst_wal_entry_hash,
        relation_hash.clone(),
        LinkTypes::DstWalToAssetRelations,
        (),
    )?;

    let asset_relation_with_tags = AssetRelationWithTags {
        src_wal: input.input.src_wal,
        dst_wal: input.input.dst_wal,
        tags: input.input.tags,
        relation_hash,
        created_at: record.action().timestamp(),
    };

    emit_signal(Signal::AssetRelationCreated {
        relation: asset_relation_with_tags.clone(),
    })?;

    Ok(asset_relation_with_tags)
}

#[derive(Serialize, Deserialize, SerializedBytes, Debug)]
pub struct AddTagsToAssetRelationInput {
    pub relation_hash: EntryHash,
    pub tags: Vec<String>,
}

/// Adds tags to an asset relation
#[hdk_extern]
pub fn add_tags_to_asset_relation(
    input: ZomeFnInput<AddTagsToAssetRelationInput>,
) -> ExternResult<()> {
    // 1. Get the AssetRelation entry to a) check that it exists and b) be able to return
    //    the src_wal and dst_wal in the signal
    let asset_relation_record = get(input.input.relation_hash.clone(), input.get_options())?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "No AssetRelation entry found for the provided hash.".into()
        )))?;

    let asset_relation = asset_relation_record
        .entry()
        .to_app_option::<AssetRelation>()
        .map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize AssetRelation record: {}",
                e
            )))
        })?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "No AssetRelation entry found in the Record associated to the provided hash.".into()
        )))?;

    for tag in input.input.tags.clone() {
        let rt_entry_hash = relationship_tag_entry_hash(&tag)?;
        let backlink_action_hash = create_link(
            rt_entry_hash.clone(),
            input.input.relation_hash.clone(),
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
            input.input.relation_hash.clone(),
            rt_entry_hash,
            LinkTypes::AssetRelationToRelationshipTags,
            LinkTag(link_tag_content_serialized),
        )?;
    }

    emit_signal(Signal::RelationTagsAdded {
        relation_hash: input.input.relation_hash,
        src_wal: asset_relation.src_wal,
        dst_wal: asset_relation.dst_wal,
        tags: input.input.tags,
    })?;
    Ok(())
}

#[hdk_extern]
pub fn remove_asset_relation(relation_hash: ZomeFnInput<EntryHash>) -> ExternResult<()> {
    let asset_relation_record = get(relation_hash.input.clone(), relation_hash.get_options())?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "No AssetRelation entry found for the provided hash.".into()
        )))?;

    let asset_relation = asset_relation_record
        .entry()
        .to_app_option::<AssetRelation>()
        .map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize AssetRelation record: {}",
                e
            )))
        })?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "No AssetRelation entry found in the Record associated to the provided hash.".into()
        )))?;

    // 0. This operation does not delete the Entry since there is no point in doing so.
    // It would only create an unnecessary delete action but an AssetRelation entry
    // is never being addressed by its ActionHash anyway. And also this is just an excuse
    // for the fact that we don't know the ActionHash anymore here in order to be able
    // to delete it. We would need to store it somewhere, for example in the tag
    // of the link to the AllAssetRelations anchor.

    // 1. remove all links from the ALL_ASSETS_RELATIONS_ANCHOR
    let path = Path::from(ALL_ASSET_RELATIONS_ANCHOR);
    let links = get_links(
        LinkQuery::try_new(path.path_entry_hash()?, LinkTypes::AllAssetRelations)?, relation_hash.get_strategy())?;
    for link in links {
        if let Some(target) = link.target.into_entry_hash() {
            if target.eq(&relation_hash.input) {
                delete_link(link.create_link_hash, GetOptions::default())?;
            }
        }
    }

    // 2. remove all tags
    remove_all_tags_from_asset_relation(relation_hash.clone())?;

    // 3. Remove all links from the source WAL
    let src_wal_entry_hash = hash_entry(asset_relation.src_wal.clone())?;
    let src_wal_links = get_links(
        LinkQuery::try_new(src_wal_entry_hash, LinkTypes::SrcWalToAssetRelations)?, relation_hash.get_strategy())?;
    for link in src_wal_links {
        if link.target.clone().into_hash() == relation_hash.input.clone().into() {
            delete_link(link.create_link_hash, GetOptions::default())?;
        }
    }

    // 4. Remove all links from the destination WAL
    let dst_wal_entry_hash = hash_entry(asset_relation.dst_wal.clone())?;
    let dst_wal_links = get_links(
        LinkQuery::try_new(dst_wal_entry_hash, LinkTypes::DstWalToAssetRelations)?, relation_hash.get_strategy())?;
    for link in dst_wal_links {
        if link.target.clone().into_hash() == relation_hash.input.clone().into() {
            delete_link(link.create_link_hash, GetOptions::default())?;
        }
    }

    emit_signal(Signal::AssetRelationRemoved {
        relation: AssetRelationAndHash {
            src_wal: asset_relation.src_wal,
            dst_wal: asset_relation.dst_wal,
            relation_hash: relation_hash.input,
            created_at: asset_relation_record.action().timestamp(),
        },
    })?;

    Ok(())
}

pub fn remove_all_tags_from_asset_relation(
    relation_hash: ZomeFnInput<EntryHash>,
) -> ExternResult<()> {
    let links = get_links(
        LinkQuery::try_new(
            relation_hash.input.clone(),
            LinkTypes::AssetRelationToRelationshipTags,
        )?, relation_hash.get_strategy()
    )?;
    for link in links {
        let link_tag_content = ExternIO::from(link.tag.0)
            .decode::<LinkTagContent>()
            .map_err(|e| {
                wasm_error!(WasmErrorInner::Guest(format!(
                    "Failed to decode link tag content: {e}"
                )))
            })?;
        delete_link(link.create_link_hash, GetOptions::default())?;
        delete_link(link_tag_content.backlink_action_hash, GetOptions::default())?;
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
    input: ZomeFnInput<RemoveTagsFromAssetRelationInput>,
) -> ExternResult<()> {
    // 1. Get the AssetRelation entry to a) check that it exists and b) be able to return
    //    the src_wal and dst_wal in the signal
    let asset_relation_record = get(input.input.relation_hash.clone(), input.get_options())?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "No AssetRelation entry found for the provided hash.".into()
        )))?;

    let asset_relation = asset_relation_record
        .entry()
        .to_app_option::<AssetRelation>()
        .map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize AssetRelation record: {}",
                e
            )))
        })?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "No AssetRelation entry found in the Record associated to the provided hash.".into()
        )))?;

    let links = get_links(
        LinkQuery::try_new(
            input.input.relation_hash.clone(),
            LinkTypes::AssetRelationToRelationshipTags,
        )?, input.get_strategy()
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
                if input.input.tags.contains(&link_tag_content.tag) {
                    delete_link(link.create_link_hash, GetOptions::default())?;
                    delete_link(link_tag_content.backlink_action_hash, GetOptions::default())?;
                }
            }
            Err(e) => {
                eprintln!("WARNING: Failed to retrieve String from link tag in zome 'remove_tags_from_asset_relation': {e}", );
            }
        }
    }
    emit_signal(Signal::RelationTagsRemoved {
        relation_hash: input.input.relation_hash,
        src_wal: asset_relation.src_wal,
        dst_wal: asset_relation.dst_wal,
        tags: input.input.tags,
    })?;
    Ok(())
}

#[hdk_extern]
pub fn get_asset_relation_by_hash(
    relation_hash: ZomeFnInput<EntryHash>,
) -> ExternResult<Option<AssetRelation>> {
    match get(relation_hash.input.clone(), relation_hash.get_options())? {
        Some(r) => Ok(r.entry().to_app_option::<AssetRelation>().ok().flatten()),
        None => Ok(None),
    }
}

#[hdk_extern]
pub fn get_all_asset_relation_hashes(input: ZomeFnInput<()>) -> ExternResult<Vec<EntryHash>> {
    let path = Path::from(ALL_ASSET_RELATIONS_ANCHOR);
    let links = get_links(
        LinkQuery::try_new(path.path_entry_hash()?, LinkTypes::AllAssetRelations)?,
        input.get_strategy(),
    )?;
    Ok(links
        .into_iter()
        .filter_map(|l| l.target.into_entry_hash())
        .collect())
}

#[hdk_extern]
pub fn get_all_asset_relations(input: ZomeFnInput<()>) -> ExternResult<Vec<AssetRelationAndHash>> {
    let path = Path::from(ALL_ASSET_RELATIONS_ANCHOR);
    let links = get_links(
        LinkQuery::try_new(path.path_entry_hash()?, LinkTypes::AllAssetRelations)?
            , input.get_strategy()
    )?;

    let get_input: Vec<GetInput> = links
        .into_iter()
        .filter_map(|l| l.target.into_entry_hash())
        .map(|target| Ok(GetInput::new(target.into(), input.get_options())))
        .collect::<ExternResult<Vec<GetInput>>>()?;

    let records: Vec<Option<Record>> = HDK.with(|hdk| hdk.borrow().get(get_input))?;

    Ok(records
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let eh = r.action().entry_hash();
            match eh {
                Some(eh) => {
                    let asset_relation = r.entry().to_app_option::<AssetRelation>().ok().flatten();
                    match asset_relation {
                        Some(a) => Some(AssetRelationAndHash {
                            src_wal: a.src_wal,
                            dst_wal: a.dst_wal,
                            relation_hash: eh.clone(),
                            created_at: r.action().timestamp(),
                        }),
                        None => None,
                    }
                }
                None => None,
            }
        })
        .collect())
}

#[hdk_extern]
pub fn get_all_asset_relations_with_tags(
    input: ZomeFnInput<()>,
) -> ExternResult<Vec<AssetRelationWithTags>> {
    let asset_relations = get_all_asset_relations(input.clone())?;
    let mut asset_relations_with_tags: Vec<AssetRelationWithTags> = Vec::new();
    for asset_relation in asset_relations {
        let links = get_links(
            LinkQuery::try_new(
                asset_relation.relation_hash.clone(),
                LinkTypes::AssetRelationToRelationshipTags,
            )?, input.get_strategy()
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
            created_at: asset_relation.created_at,
        });
    }
    Ok(asset_relations_with_tags)
}

#[hdk_extern]
pub fn get_outgoing_asset_relations_with_tags(
    src_wal: ZomeFnInput<WAL>,
) -> ExternResult<Vec<AssetRelationWithTags>> {
    let asset_relations = get_outgoing_asset_relations(src_wal.clone())?;
    let mut asset_relations_with_tags: Vec<AssetRelationWithTags> = Vec::new();
    for asset_relation in asset_relations {
        let links = get_links(
            LinkQuery::try_new(
                asset_relation.relation_hash.clone(),
                LinkTypes::AssetRelationToRelationshipTags,
            )?, src_wal.get_strategy()
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
            created_at: asset_relation.created_at,
        });
    }
    Ok(asset_relations_with_tags)
}

#[hdk_extern]
pub fn get_outgoing_asset_relations(
    src_wal: ZomeFnInput<WAL>,
) -> ExternResult<Vec<AssetRelationAndHash>> {
    let src_wal_entry_hash = hash_entry(&src_wal.input)?;
    let src_wal_links = get_links(
        LinkQuery::try_new(src_wal_entry_hash, LinkTypes::SrcWalToAssetRelations)?
        , src_wal.get_strategy()
    )?;
    let get_input: Vec<GetInput> = src_wal_links
        .into_iter()
        .filter_map(|l| l.target.into_entry_hash())
        .unique() // We filter out duplicate links here
        .map(|target| Ok(GetInput::new(target.into(), src_wal.get_options())))
        .collect::<ExternResult<Vec<GetInput>>>()?;
    let records: Vec<Option<Record>> = HDK.with(|hdk| hdk.borrow().get(get_input))?;
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
                    created_at: record.action().timestamp(),
                };
                asset_relations.push(asset_relation_and_hash)
            }
        }
    }
    Ok(asset_relations)
}

#[hdk_extern]
pub fn get_incoming_asset_relations_with_tags(
    dst_wal: ZomeFnInput<WAL>,
) -> ExternResult<Vec<AssetRelationWithTags>> {
    let asset_relations = get_incoming_asset_relations(dst_wal.clone())?;
    let mut asset_relations_with_tags: Vec<AssetRelationWithTags> = Vec::new();
    for asset_relation in asset_relations {
        let links = get_links(
            LinkQuery::try_new(
                asset_relation.relation_hash.clone(),
                LinkTypes::AssetRelationToRelationshipTags,
            )?, dst_wal.get_strategy()
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
            created_at: asset_relation.created_at,
        });
    }
    Ok(asset_relations_with_tags)
}

#[hdk_extern]
pub fn get_incoming_asset_relations(
    dst_wal: ZomeFnInput<WAL>,
) -> ExternResult<Vec<AssetRelationAndHash>> {
    let dst_wal_entry_hash = hash_entry(&dst_wal.input)?;
    let dst_wal_links = get_links(
        LinkQuery::try_new(dst_wal_entry_hash, LinkTypes::DstWalToAssetRelations)?
        , dst_wal.get_strategy()
    )?;
    let get_input: Vec<GetInput> = dst_wal_links
        .into_iter()
        .filter_map(|l| l.target.into_entry_hash())
        .unique() // We filter out duplicate links here
        .map(|target| Ok(GetInput::new(target.into(), dst_wal.get_options())))
        .collect::<ExternResult<Vec<GetInput>>>()?;
    let records: Vec<Option<Record>> = HDK.with(|hdk| hdk.borrow().get(get_input))?;
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
                    created_at: record.action().timestamp(),
                };
                asset_relations.push(asset_relation_and_hash)
            }
        }
    }
    Ok(asset_relations)
}

#[hdk_extern]
pub fn get_asset_relations_for_relationship_tag(
    tag: ZomeFnInput<String>,
) -> ExternResult<Vec<AssetRelationAndHash>> {
    let rt_entry_hash = relationship_tag_entry_hash(&tag.input)?;
    let links = get_links(
        LinkQuery::try_new(rt_entry_hash, LinkTypes::RelationshipTagToAssetRelation)?
            , tag.get_strategy()
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
                tag.get_options(),
            ))
        })
        .collect::<ExternResult<Vec<GetInput>>>()?;
    let records: Vec<Option<Record>> = HDK.with(|hdk| hdk.borrow().get(get_input))?;
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
                    created_at: record.action().timestamp(),
                };
                asset_relations.push(asset_relation_and_hash)
            }
        }
    }
    Ok(asset_relations)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RelationsForWal {
    pub wal: WAL,
    pub tags: Vec<String>,
    pub linked_to: Vec<AssetRelationWithTags>,
    pub linked_from: Vec<AssetRelationWithTags>,
}

#[hdk_extern]
pub fn get_all_relations_for_wal(wal: ZomeFnInput<WAL>) -> ExternResult<RelationsForWal> {
    let tags = get_tags_for_asset(wal.clone())?;
    let linked_from = get_outgoing_asset_relations_with_tags(wal.clone())?;
    let linked_to = get_incoming_asset_relations_with_tags(wal.clone())?;
    Ok(RelationsForWal {
        wal: wal.input,
        tags,
        linked_to,
        linked_from,
    })
}

#[hdk_extern]
pub fn batch_get_all_relations_for_wal(
    wals: ZomeFnInput<Vec<WAL>>,
) -> ExternResult<Vec<RelationsForWal>> {
    let mut result: Vec<RelationsForWal> = Vec::new();
    for wal in wals.input {
        result.push(get_all_relations_for_wal(ZomeFnInput {
            input: wal,
            local: wals.local,
        })?)
    }
    Ok(result)
}

#[hdk_extern]
fn hash_asset_relation(asset_relation: AssetRelation) -> ExternResult<EntryHash> {
    hash_entry(asset_relation)
}

#[hdk_extern]
fn hash_wal(wal: WAL) -> ExternResult<EntryHash> {
    hash_entry(wal)
}
