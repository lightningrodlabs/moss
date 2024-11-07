pub mod associations;
pub mod relations;
use assets_integrity::*;
use hdk::prelude::*;
use relations::{AssetRelationAndHash, AssetRelationWithTags};

// Called the first time a zome call is made to the cell containing this zome
#[hdk_extern]
pub fn init() -> ExternResult<InitCallbackResult> {
    Ok(InitCallbackResult::Pass)
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type", content = "content")]
pub enum Signal {
    Local(SignalKind),
    Remote(SignalKind),
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum SignalKind {
    AssetTagsAdded {
        wal: WAL,
        tags: Vec<String>,
    },
    AssetTagsRemoved {
        wal: WAL,
        tags: Vec<String>,
    },
    AssetRelationCreated {
        relation: AssetRelationWithTags,
    },
    AssetRelationRemoved {
        relation: AssetRelationAndHash,
    },
    RelationTagsAdded {
        relation_hash: EntryHash,
        tags: Vec<String>,
    },
    RelationTagsRemoved {
        relation_hash: EntryHash,
        tags: Vec<String>,
    },
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RemoteSignal {
    signal: Signal,
}

// Whenever an action is committed, we emit a signal to the UI elements to reactively update them
#[hdk_extern(infallible)]
pub fn post_commit(_committed_actions: Vec<SignedActionHashed>) {
    ()
}
