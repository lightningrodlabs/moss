use crate::{Signal, SignalKind};
use assets_integrity::*;
use hdk::prelude::*;

#[derive(Serialize, Deserialize, Debug)]
pub struct TagsToAssetInput {
    pub wal: WAL,
    pub tags: Vec<String>,
}

#[hdk_extern]
pub fn add_tags_to_asset(input: TagsToAssetInput) -> ExternResult<()> {
    let wal_hash = hash_entry(input.wal.clone())?;
    for tag in input.tags.clone() {
        let tag_entry_hash = association_tag_entry_hash(&tag)?;
        create_link(
            wal_hash.clone(),
            tag_entry_hash.clone(),
            LinkTypes::WalToAssociationTags,
            LinkTag(tag.into_bytes()),
        )?;
        create_link(
            tag_entry_hash,
            wal_hash.clone(),
            LinkTypes::AssociationTagToWals,
            (),
        )?;
    }

    emit_signal(Signal::Local(SignalKind::AssetTagsAdded {
        wal: input.wal,
        tags: input.tags,
    }))?;

    Ok(())
}

#[hdk_extern]
pub fn remove_tags_from_asset(input: TagsToAssetInput) -> ExternResult<()> {
    let wal_hash = hash_entry(input.wal.clone())?;
    // 1. Remove links from WAL to tags
    let links = get_links(
        GetLinksInputBuilder::try_new(wal_hash.clone(), LinkTypes::WalToAssociationTags)?.build(),
    )?;
    for link in links {
        match std::str::from_utf8(&link.tag.0) {
            Ok(tag) => {
                if input.tags.contains(&tag.to_string()) {
                    delete_link(link.create_link_hash)?;
                }
            }
            Err(e) => {
                eprintln!("WARNING: Failed to retrieve String from link tag in zome 'remove_tags_from_asset': {e}", );
            }
        }
    }

    // 2. Remove links from tags to WAL
    for tag in input.tags.clone() {
        let tag_entry_hash = association_tag_entry_hash(&tag)?;
        let links = get_links(
            GetLinksInputBuilder::try_new(tag_entry_hash, LinkTypes::AssociationTagToWals)?.build(),
        )?;
        for link in links {
            if link.target.clone().into_hash() == wal_hash.clone().into() {
                delete_link(link.create_link_hash)?;
            }
        }
    }

    emit_signal(Signal::Local(SignalKind::AssetTagsRemoved {
        wal: input.wal,
        tags: input.tags,
    }))?;

    Ok(())
}

#[hdk_extern]
pub fn get_tags_for_asset(wal: WAL) -> ExternResult<Vec<String>> {
    let wal_hash = hash_entry(wal)?;
    let links = get_links(
        GetLinksInputBuilder::try_new(wal_hash, LinkTypes::WalToAssociationTags)?.build(),
    )?;
    Ok(links
        .iter()
        .map(|l| std::str::from_utf8(&l.tag.0).ok())
        .filter_map(|t| t)
        .map(|s| s.to_string())
        .collect::<Vec<String>>())
}
