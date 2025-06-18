use group_integrity::*;
use hdk::prelude::*;
use moss_helpers::ZomeFnInput;

#[hdk_extern]
pub fn get_all_group_profiles(input: ZomeFnInput<()>) -> ExternResult<Vec<Link>> {
    let path = Path::from("all_group_profiles");
    get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AllGroupProfiles)?
            .get_options(input.into())
            .build(),
    )
}
