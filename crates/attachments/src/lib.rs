use hc_zome_attachments_integrity::*;
use hdk::prelude::*;

#[derive(Serialize, Deserialize, Debug)]
pub struct LinkingInput {
    src_wal: Wal,
    dst_wal: Wal,
}

#[hdk_extern]
pub fn create_outgoing_link(input: LinkingInput) -> ExternResult<ActionHash> {
    let src_wal_entry_hash = hash_entry(EntryTypes::Wal(input.src_wal.clone()))?;
    create_entry(EntryTypes::Wal(input.src_wal))?;
    let dst_wal_entry_hash = hash_entry(EntryTypes::Wal(input.dst_wal.clone()))?;
    create_entry(EntryTypes::Wal(input.dst_wal))?;

    Ok(create_link(
        AnyLinkableHash::from(src_wal_entry_hash),
        AnyLinkableHash::from(dst_wal_entry_hash),
        LinkTypes::Outgoing,
        LinkTag::new("outgoing"),
    )?)
}

/// Takes a WAL as input and returns the WALs that are attached to that WAL
#[hdk_extern]
pub fn get_outgoing_links(wal: Wal) -> ExternResult<Vec<Wal>> {
    let wal_hash = hash_entry(EntryTypes::Wal(wal))?;
    let links = get_links(wal_hash, LinkTypes::Outgoing, None)?;
    let mut outgoing_links = Vec::new();

    for link in links {
        let entry_hash = EntryHash::try_from(link.target).map_err(|_| {
            wasm_error!(WasmErrorInner::Guest(
                "Failed to convert link target to entry hash".into()
            ))
        })?;
        let maybe_record = get(entry_hash, GetOptions::default())?;
        if let Some(record) = maybe_record {
            let wal = record.entry().to_app_option::<Wal>().map_err(|_| {
                wasm_error!(WasmErrorInner::Guest(
                    "Failed to convert record to Wal".into()
                ))
            })?;
            wal.map(|w| outgoing_links.push(w));
        };
    }

    Ok(outgoing_links)
}

#[hdk_extern]
pub fn create_incoming_link(input: LinkingInput) -> ExternResult<ActionHash> {
    let src_wal_entry_hash = hash_entry(EntryTypes::Wal(input.src_wal.clone()))?;
    create_entry(EntryTypes::Wal(input.src_wal))?;
    let dst_wal_entry_hash = hash_entry(EntryTypes::Wal(input.dst_wal.clone()))?;
    create_entry(EntryTypes::Wal(input.dst_wal))?;

    Ok(create_link(
        AnyLinkableHash::from(dst_wal_entry_hash),
        AnyLinkableHash::from(src_wal_entry_hash),
        LinkTypes::Incoming,
        LinkTag::new("incoming"),
    )?)
}

/// Takes a WAL as input and returns the WALs this WAL is bound to
#[hdk_extern]
pub fn get_incoming_links(wal: Wal) -> ExternResult<Vec<Wal>> {
    let wal_hash = hash_entry(EntryTypes::Wal(wal))?;
    let links: Vec<Link> = get_links(wal_hash, LinkTypes::Incoming, None)?;
    let mut incoming_links = Vec::new();

    for link in links {
        let entry_hash = EntryHash::try_from(link.target).map_err(|_| {
            wasm_error!(WasmErrorInner::Guest(
                "Failed to convert link target to entry hash".into()
            ))
        })?;
        let maybe_record = get(entry_hash, GetOptions::default())?;
        if let Some(record) = maybe_record {
            let wal = record.entry().to_app_option::<Wal>().map_err(|_| {
                wasm_error!(WasmErrorInner::Guest(
                    "Failed to convert record to Wal".into()
                ))
            })?;
            wal.map(|w| incoming_links.push(w));
        };
    }

    Ok(incoming_links)
}

#[hdk_extern]
pub fn remove_outgoing_link(input: LinkingInput) -> ExternResult<Vec<ActionHash>> {
    let entry_hash = hash_entry(EntryTypes::Wal(input.src_wal))?;
    let links = get_links(entry_hash, LinkTypes::Outgoing, None)?;

    let mut links_to_delete = Vec::new();

    for link in links {
        match EntryHash::try_from(link.target.clone()) {
            Ok(eh) => {
                let maybe_dst_wal = get(eh, GetOptions::default())?;
                match maybe_dst_wal {
                    Some(record) => {
                        match record.entry().to_app_option::<Wal>() {
                            Ok(Some(dst_wal)) => {
                                if dst_wal == input.dst_wal {
                                    links_to_delete.push(link);
                                }
                            }
                            _ => (),
                        };
                    }
                    None => (),
                }
            }
            Err(_) => (),
        }
    }

    let mut link_deletes = Vec::new();

    for link_to_delete in links_to_delete {
        let delete_action = delete_link(link_to_delete.create_link_hash)?;
        link_deletes.push(delete_action);
    }

    Ok(link_deletes)
}

#[hdk_extern]
pub fn remove_incoming_link(input: LinkingInput) -> ExternResult<Vec<ActionHash>> {
    let entry_hash = hash_entry(EntryTypes::Wal(input.dst_wal))?;
    let links = get_links(entry_hash, LinkTypes::Incoming, None)?;

    let mut links_to_delete = Vec::new();

    for link in links {
        match EntryHash::try_from(link.target.clone()) {
            Ok(eh) => {
                let maybe_src_wal = get(eh, GetOptions::default())?;
                match maybe_src_wal {
                    Some(record) => {
                        match record.entry().to_app_option::<Wal>() {
                            Ok(Some(src_wal)) => {
                                if src_wal == input.src_wal {
                                    links_to_delete.push(link);
                                }
                            }
                            _ => (),
                        };
                    }
                    None => (),
                }
            }
            Err(_) => (),
        }
    }

    let mut link_deletes = Vec::new();

    for link_to_delete in links_to_delete {
        let delete_action = delete_link(link_to_delete.create_link_hash)?;
        link_deletes.push(delete_action)
    }

    Ok(link_deletes)
}
