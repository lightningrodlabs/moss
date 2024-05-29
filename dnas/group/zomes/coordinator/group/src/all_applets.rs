use hdk::prelude::*;
use group_integrity::*;

#[hdk_extern]
pub fn get_all_applets() -> ExternResult<Vec<Link>> {
    let path = Path::from("all_applets");
    get_links(GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AllApplets)?.build())
}
