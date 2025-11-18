use group_integrity::*;
use hdk::prelude::*;
use moss_helpers::ZomeFnInput;

#[hdk_extern]
pub fn get_all_steward_permissions(input: ZomeFnInput<()>) -> ExternResult<Vec<Link>> {
    let path = Path::from("all_steward_permissions");
    get_links(
        LinkQuery::try_new(path.path_entry_hash()?, LinkTypes::AllStewardPermissions)?
          , input.into()
    )
}
