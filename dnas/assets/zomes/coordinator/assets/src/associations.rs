use crate::Signal;
use assets_integrity::*;
use hdk::prelude::*;
use moss_helpers::ZomeFnInput;

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

    emit_signal(Signal::AssetTagsAdded {
        wal: input.wal,
        tags: input.tags,
    })?;

    Ok(())
}

#[hdk_extern]
pub fn remove_tags_from_asset(input: ZomeFnInput<TagsToAssetInput>) -> ExternResult<()> {
    let wal_hash = hash_entry(input.input.wal.clone())?;
    // 1. Remove links from WAL to tags
    let links = get_links(LinkQuery::try_new(wal_hash.clone(), LinkTypes::WalToAssociationTags)?, input.get_strategy())?;
    for link in links {
        match std::str::from_utf8(&link.tag.0) {
            Ok(tag) => {
                if input.input.tags.contains(&tag.to_string()) {
                    delete_link(link.create_link_hash, GetOptions::default())?;
                }
            }
            Err(e) => {
                eprintln!("WARNING: Failed to retrieve String from link tag in zome 'remove_tags_from_asset': {e}", );
            }
        }
    }

    // 2. Remove links from tags to WAL
    for tag in input.input.tags.clone() {
        let tag_entry_hash = association_tag_entry_hash(&tag)?;
        let links = get_links(LinkQuery::try_new(tag_entry_hash, LinkTypes::AssociationTagToWals)?, input.get_strategy())?;
        for link in links {
            if link.target.clone().into_hash() == wal_hash.clone().into() {
                delete_link(link.create_link_hash, GetOptions::default())?;
            }
        }
    }

    emit_signal(Signal::AssetTagsRemoved {
        wal: input.input.wal,
        tags: input.input.tags,
    })?;

    Ok(())
}

#[hdk_extern]
pub fn get_tags_for_asset(wal: ZomeFnInput<WAL>) -> ExternResult<Vec<String>> {
    let wal_hash = hash_entry(wal.input.clone())?;
    let links = get_links(
        LinkQuery::try_new(wal_hash, LinkTypes::WalToAssociationTags)?, wal.get_strategy())?;
    Ok(links
        .iter()
        .map(|l| std::str::from_utf8(&l.tag.0).ok())
        .filter_map(|t| t)
        .map(|s| s.to_string())
        .collect::<Vec<String>>())
}
