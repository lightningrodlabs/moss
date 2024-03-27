use hdi::prelude::*;

#[hdk_link_types]
pub enum LinkTypes {
    Incoming,
    Outgoing,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
#[hdk_entry_types]
#[unit_enum(UnitEntryTypes)]
pub enum EntryTypes {
    Wal(Wal),
}

/// String of type weave://[DnaHash]/[AnyDhtHash]?context=[encoded context]
#[hdk_entry_helper]
#[derive(Clone)]
pub struct Wal(String);

impl PartialEq for Wal {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

// impl Wal {
//     fn to_string(self) -> String {
//         self.0
//     }
// }

// TODO validate format of Wal
// potentially only allow the person to remove a link that created it?
