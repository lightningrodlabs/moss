pub mod all_posts;
pub mod post;
use hdk::prelude::*;
use posts_integrity::*;
#[hdk_extern]
pub fn init(_: ()) -> ExternResult<InitCallbackResult> {
    let peers_anchor = anchor(LinkTypes::PeerSubscription, String::from("PEER_SUBSCRIPTION"), String::from("PEER_SUBSCRIPTION"))?;
    create_link(peers_anchor, agent_info()?.agent_initial_pubkey, LinkTypes::PeerSubscription, ())?;
    Ok(InitCallbackResult::Pass)
}
#[derive(Serialize, Deserialize, Debug, SerializedBytes)]
#[serde(tag = "type")]
pub enum Signal {
    LinkCreated { action: SignedActionHashed, link_type: LinkTypes },
    LinkDeleted { action: SignedActionHashed, link_type: LinkTypes },
    EntryCreated { action: SignedActionHashed, app_entry: EntryTypes },
    EntryUpdated {
        action: SignedActionHashed,
        app_entry: EntryTypes,
        original_app_entry: EntryTypes,
    },
    EntryDeleted { action: SignedActionHashed, original_app_entry: EntryTypes },
    NewPost { post: Post, timestamp: Timestamp },
}

#[hdk_extern(infallible)]
pub fn post_commit(committed_actions: Vec<SignedActionHashed>) {
    for action in committed_actions {
        if let Err(err) = signal_action(action) {
            error!("Error signaling new action: {:?}", err);
        }
    }
}
fn signal_action(action: SignedActionHashed) -> ExternResult<()> {
    match action.hashed.content.clone() {
        Action::CreateLink(create_link) => {
            if let Ok(Some(link_type))
                = LinkTypes::from_type(create_link.zome_index, create_link.link_type) {
                emit_signal(Signal::LinkCreated {
                    action,
                    link_type,
                })?;
            }
            Ok(())
        }
        Action::DeleteLink(delete_link) => {
            let record = get(
                    delete_link.link_add_address.clone(),
                    GetOptions::default(),
                )?
                .ok_or(
                    wasm_error!(
                        WasmErrorInner::Guest("Failed to fetch CreateLink action"
                        .to_string())
                    ),
                )?;
            match record.action() {
                Action::CreateLink(create_link) => {
                    if let Ok(Some(link_type))
                        = LinkTypes::from_type(
                            create_link.zome_index,
                            create_link.link_type,
                        ) {
                        emit_signal(Signal::LinkDeleted {
                            action,
                            link_type,
                        })?;
                    }
                    Ok(())
                }
                _ => {
                    return Err(
                        wasm_error!(
                            WasmErrorInner::Guest("Create Link should exist".to_string())
                        ),
                    );
                }
            }
        }
        Action::Create(create) => {
            if let Ok(Some(app_entry)) = get_entry_for_action(&action.hashed.hash) {
                emit_signal(Signal::EntryCreated {
                    action,
                    app_entry: app_entry.clone(),
                })?;

                match app_entry {
                    EntryTypes::Post(post) => {
                        let signal = Signal::NewPost { post, timestamp: create.timestamp };
                        let peers_anchor = anchor(LinkTypes::PeerSubscription, String::from("PEER_SUBSCRIPTION"), String::from("PEER_SUBSCRIPTION"))?;
                        let peer_links = get_links(peers_anchor, LinkTypes::PeerSubscription, None)?;
                        let peers = peer_links.iter()
                            .filter_map(|link| AgentPubKey::try_from(link.target.clone()).ok())
                            .collect::<Vec<AgentPubKey>>();
                        remote_signal(ExternIO::encode(signal), peers)?;
                    },
                    _ => (),
                }
            }
            Ok(())
        }
        Action::Update(update) => {
            if let Ok(Some(app_entry)) = get_entry_for_action(&action.hashed.hash) {
                if let Ok(Some(original_app_entry))
                    = get_entry_for_action(&update.original_action_address) {
                    emit_signal(Signal::EntryUpdated {
                        action,
                        app_entry,
                        original_app_entry,
                    })?;
                }
            }
            Ok(())
        }
        Action::Delete(delete) => {
            if let Ok(Some(original_app_entry))
                = get_entry_for_action(&delete.deletes_address) {
                emit_signal(Signal::EntryDeleted {
                    action,
                    original_app_entry,
                })?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}
fn get_entry_for_action(action_hash: &ActionHash) -> ExternResult<Option<EntryTypes>> {
    let record = match get_details(action_hash.clone(), GetOptions::default())? {
        Some(Details::Record(record_details)) => record_details.record,
        _ => {
            return Ok(None);
        }
    };
    let entry = match record.entry().as_option() {
        Some(entry) => entry,
        None => {
            return Ok(None);
        }
    };
    let (zome_index, entry_index) = match record.action().entry_type() {
        Some(EntryType::App(AppEntryDef { zome_index, entry_index, .. })) => {
            (zome_index, entry_index)
        }
        _ => {
            return Ok(None);
        }
    };
    Ok(
        EntryTypes::deserialize_from_type(
            zome_index.clone(),
            entry_index.clone(),
            entry,
        )?,
    )
}


#[hdk_extern]
fn recv_remote_signal(signal: SerializedBytes) -> ExternResult<()> {

  // decode and emit to the UI
  let maybe_decoded_signal = Signal::try_from(signal.clone());
  match maybe_decoded_signal {
    Ok(signal) => {
      debug!("💌💌💌💌 Agent {:?} RECEIVED SIGNAL: {:?}", agent_info()?.agent_initial_pubkey,  signal);
      emit_signal(signal)?;
      Ok(())
    },
    Err(e) => Err(wasm_error!(WasmErrorInner::Guest(format!("Failed to decode remote signal: {}", e))))
  }
}
