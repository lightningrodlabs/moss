use hdk::prelude::*;

#[derive(Serialize, Deserialize, Debug)]
pub struct HrlLocation {
    integrity_zome: ZomeName,
    entry_def_index: EntryDefIndex,
}

#[hdk_extern]
pub fn locate_hrl(hash: AnyDhtHash) -> ExternResult<Option<HrlLocation>> {
    let Some(record) = get(hash, GetOptions::default())? else {
        return Ok(None);
    };

    match record.signed_action.action().clone() {
        Action::Create(create) => locate(create.entry_type),
        Action::Update(update) => locate(update.entry_type),
        _ => Err(wasm_error!(WasmErrorInner::Guest(
            "Given hash does not correspond ".to_string()
        ))),
    }
}

fn locate(entry_type: EntryType) -> ExternResult<Option<HrlLocation>> {
    let app_entry_def = match entry_type {
        EntryType::App(app_entry_def) => Ok(app_entry_def),
        _ => Err(wasm_error!(WasmErrorInner::Guest("".to_string()))),
    }?;

    let info = dna_info()?;
    let integrity_zome = info
        .zome_names
        .get(app_entry_def.zome_index.index())
        .ok_or(wasm_error!(WasmErrorInner::Guest("".to_string())))?;
    Ok(Some(HrlLocation {
        integrity_zome: integrity_zome.clone(),
        entry_def_index: app_entry_def.entry_index,
    }))
}
