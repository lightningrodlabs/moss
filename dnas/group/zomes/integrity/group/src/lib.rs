use hdi::prelude::*;
pub use we_types::{Applet, GroupProfile};

#[hdk_entry_defs]
#[unit_enum(UnitEntryTypes)]
pub enum EntryTypes {
    Applet(Applet),
    #[entry_def(visibility = "private")]
    AppletPrivate(Applet),
    RelatedGroup(RelatedGroup),
    GroupProfile(GroupProfile),
}

#[hdk_link_types]
pub enum LinkTypes {
    AnchorToApplet,
    AgentToApplet,
    AppletToExternalAgent,
    AppletToInvitedGroup, // links to "first-order" neighbor groups if an app is being federated
    GroupInfoPath,
    AnchorToFederatedApplet,
    AnchorToGroupProfile,
    AnchorToRelatedGroup,
}

#[hdk_entry_helper]
#[derive(Clone)]
pub struct RelatedGroup {
    pub group_profile: GroupProfile,
    pub network_seed: String,
    pub group_dna_hash: DnaHash,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RegisterAppletFederationInput {
    pub applet_hash: EntryHash,
    pub group_dna_hash: EntryHash,
}
