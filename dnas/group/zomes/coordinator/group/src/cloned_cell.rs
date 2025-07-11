use group_integrity::*;
use hdk::prelude::*;
use moss_helpers::ZomeFnInput;

/// Registers the cloned cell in the group DNA. This is probably mainly useful
/// for always-online nodes and has implications for privacy in case that there
/// are cloned cells that are not supposed to be joined by all group members
#[hdk_extern]
fn join_cloned_cell(input: ZomeFnInput<AppletClonedCell>) -> ExternResult<EntryHash> {
    let entry_hash = hash_entry(&input.input)?;

    // try to get the entry and only create it if not found
    let maybe_entry = get(entry_hash.clone(), input.get_options())?;

    if let None = maybe_entry {
        create_entry(EntryTypes::AppletClonedCell(input.input.clone()))?;
        // Create a link from the Applet entry to make this cloned cell be discoverable
        create_link(
            input.input.applet_hash.clone(),
            entry_hash.clone(),
            LinkTypes::AppletToAppletClonedCell,
            (),
        )?;
    }

    // Store a local copy of the Applet struct to the source chain as a private entry
    create_entry(EntryTypes::AppletClonedCellPrivate(
        AppletClonedCellPrivate {
            public_entry_hash: entry_hash.clone(),
            applet_cloned_cell: input.input,
        },
    ))?;

    Ok(entry_hash)
}

/// Gets all cloned cells related to an Applet
#[hdk_extern]
fn get_all_cloned_cell_entry_hashes_for_applet(
    applet_hash: ZomeFnInput<EntryHash>,
) -> ExternResult<Vec<EntryHash>> {
    let links = get_links(
        GetLinksInputBuilder::try_new(
            applet_hash.input.clone(),
            LinkTypes::AppletToAppletClonedCell,
        )?
        .get_options(applet_hash.into())
        .build(),
    )?;
    Ok(links
        .into_iter()
        .filter_map(|l| l.target.into_entry_hash())
        .collect())
}

/// Gets all cloned cells related to an Applet
#[hdk_extern]
fn get_all_cloned_cells_for_applet(
    applet_hash: ZomeFnInput<EntryHash>,
) -> ExternResult<Vec<AppletClonedCell>> {
    let links = get_links(
        GetLinksInputBuilder::try_new(
            applet_hash.input.clone(),
            LinkTypes::AppletToAppletClonedCell,
        )?
        .get_options(applet_hash.clone().into())
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
                applet_hash.get_options(),
            ))
        })
        .collect::<ExternResult<Vec<GetInput>>>()?;
    let records = HDK.with(|hdk| hdk.borrow().get(get_input))?;
    Ok(records
        .iter()
        .flatten()
        .filter_map(|r| r.entry().to_app_option::<AppletClonedCell>().ok())
        .flatten()
        .collect())
}

#[hdk_extern]
fn get_unjoined_cloned_cells_for_applet(
    applet_hash: ZomeFnInput<EntryHash>,
) -> ExternResult<Vec<EntryHash>> {
    let entry_type: EntryType = UnitEntryTypes::AppletClonedCellPrivate.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(entry_type)
        .include_entries(true);

    let records = query(filter)?;

    let applet_cloned_cell_private_entries = records
        .into_iter()
        .filter_map(|record| record.entry.to_app_option::<AppletClonedCellPrivate>().ok())
        .flatten()
        .collect::<Vec<AppletClonedCellPrivate>>();

    let applet_cloned_cell_public_hashes = applet_cloned_cell_private_entries
        .into_iter()
        .map(|ac| ac.public_entry_hash)
        .collect::<Vec<EntryHash>>();

    let all_applet_cloned_cells_entry_hashes =
        get_all_cloned_cell_entry_hashes_for_applet(applet_hash)?;

    Ok(all_applet_cloned_cells_entry_hashes
        .into_iter()
        .filter(|eh| !applet_cloned_cell_public_hashes.contains(&eh))
        .collect())
}

#[hdk_extern]
fn get_applet_cloned_cell(
    applet_cloned_cell_entry_hash: ZomeFnInput<EntryHash>,
) -> ExternResult<Option<AppletClonedCell>> {
    // First try getting it from the source chain
    match get_private_applet_cloned_cell_copy(applet_cloned_cell_entry_hash.input.clone()) {
        Ok(Some(applet_cloned_cell_copy)) => Ok(Some(applet_cloned_cell_copy.applet_cloned_cell)),
        // Otherwise try getting it from the network
        Ok(None) => {
            let maybe_applet_cloned_cell_record = get(
                applet_cloned_cell_entry_hash.input.clone(),
                applet_cloned_cell_entry_hash.get_options(),
            )?;
            match maybe_applet_cloned_cell_record {
                Some(record) => record
                    .entry
                    .to_app_option::<AppletClonedCell>()
                    .map_err(|e| {
                        wasm_error!(WasmErrorInner::Guest(format!(
                            "Failed to deserialize AppletClonedCell from record: {}",
                            e
                        )))
                    }),
                None => Ok(None),
            }
        }
        Err(e) => Err(e),
    }
}

/// Gets the private entry copy for the given public Applet entry.
#[hdk_extern]
fn get_private_applet_cloned_cell_copy(
    applet_cloned_cell_entry_hash: EntryHash,
) -> ExternResult<Option<AppletClonedCellPrivate>> {
    let entry_type: EntryType = UnitEntryTypes::AppletClonedCellPrivate.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(entry_type)
        .include_entries(true);

    let records = query(filter)?;
    let applet_cloned_cell_copies = records
        .into_iter()
        .map(|record| record.entry.to_app_option::<AppletClonedCellPrivate>().ok())
        .filter_map(|ac| ac)
        .filter_map(|ac| ac)
        .collect::<Vec<AppletClonedCellPrivate>>();
    Ok(applet_cloned_cell_copies
        .into_iter()
        .find(|copy| copy.public_entry_hash == applet_cloned_cell_entry_hash))
}
