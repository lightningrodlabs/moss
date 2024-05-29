use group_integrity::*;
use hdk::prelude::*;

#[hdk_extern]
pub fn get_all_steward_permissions() -> ExternResult<Vec<Link>> {
    let path = Path::from("all_steward_permissions");
    get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AllStewardPermissions)?
            .build(),
    )
}
