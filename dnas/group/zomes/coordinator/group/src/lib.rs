pub mod all_group_profiles;
pub mod all_steward_permissions;
pub mod applet;
pub mod cloned_cell;
pub mod group_meta_data;
pub mod group_profile;
pub mod steward_permission;
use group_integrity::*;
use hdk::prelude::*;

#[hdk_extern]
pub fn init() -> ExternResult<InitCallbackResult> {
    let mut functions = BTreeSet::new();
    functions.insert((zome_info()?.name, FunctionName("recv_remote_signal".into())));
    let cap_grant_entry: CapGrantEntry = CapGrantEntry::new(
        String::from("arbitrary remote signals"), // A string by which to later query for saved grants.
        ().into(), // Unrestricted access means any external agent can call the extern
        GrantedFunctions::Listed(functions),
    );

    create_cap_grant(cap_grant_entry)?;
    Ok(InitCallbackResult::Pass)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum SignalPayload {
    Arbitrary { content: Vec<u8> },
}

#[hdk_extern(infallible)]
pub fn post_commit(_committed_actions: Vec<SignedActionHashed>) {
    ()
}

#[hdk_extern]
pub fn recv_remote_signal(signal: ExternIO) -> ExternResult<()> {
    let signal_payload: SignalPayload = signal
        .decode()
        .map_err(|err| wasm_error!(WasmErrorInner::Guest(err.into())))?;

    match signal_payload.clone() {
        SignalPayload::Arbitrary { .. } => emit_signal(signal_payload),
    }
}

#[derive(Serialize, Deserialize, SerializedBytes, Debug, Clone)]
pub struct ArbitrarySignalPayload {
    pub to_agents: Vec<AgentPubKey>,
    pub content: Vec<u8>,
}

#[hdk_extern]
fn remote_signal_arbitrary(input: ArbitrarySignalPayload) -> ExternResult<()> {
    let signal_payload = SignalPayload::Arbitrary {
        content: input.content,
    };
    let encoded_signal = ExternIO::encode(signal_payload)
        .map_err(|err| wasm_error!(WasmErrorInner::Guest(err.into())))?;
    send_remote_signal(encoded_signal, input.to_agents)
}

/// Assumes that the passed links has an action hash as target and tries to get the Record
/// associated to the target of the link with the latest timestamp
pub fn get_latest_record_from_links(
    mut links: Vec<Link>,
    get_options: GetOptions,
) -> ExternResult<Option<Record>> {
    links.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    for link in links {
        if let Some(action_hash) = link.target.into_action_hash() {
            let maybe_record = get(action_hash, get_options.clone())?;
            if let Some(record) = maybe_record {
                return Ok(Some(record));
            }
        }
    }
    Ok(None)
}
