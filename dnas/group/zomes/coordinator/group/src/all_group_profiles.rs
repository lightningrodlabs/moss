use hdk::prelude::*;
use group_integrity::*;

#[hdk_extern]
pub fn get_all_group_profiles() -> ExternResult<Vec<Link>> {
    let path = Path::from("all_group_profiles");
    get_links(GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AllGroupProfiles)?.build())
}
