//! ## hc_zome_peer_status_coordinator
//!
//! Coordinator zome to display the online/offline status of agents in a holochain app.
//!
//! Read about how to include both this zome and its frontend module in your application [here](https://holochain-open-dev.github.io/peer-status).
use hdk::prelude::*;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum SignalPayload {
    Ping {
        from_agent: AgentPubKey,
        status: String,
        tz_utc_offset: Option<f32>,
    },
    Pong {
        from_agent: AgentPubKey,
        status: String,
        tz_utc_offset: Option<f32>,
    },
}

#[hdk_extern]
pub fn init(_: ()) -> ExternResult<InitCallbackResult> {
    let mut functions = BTreeSet::new();
    functions.insert((zome_info()?.name, FunctionName("recv_remote_signal".into())));
    let cap_grant_entry: CapGrantEntry = CapGrantEntry::new(
        String::from("ping pong signals"), // A string by which to later query for saved grants.
        ().into(), // Unrestricted access means any external agent can call the extern
        GrantedFunctions::Listed(functions),
    );

    create_cap_grant(cap_grant_entry)?;
    Ok(InitCallbackResult::Pass)
}

#[hdk_extern]
pub fn recv_remote_signal(signal: ExternIO) -> ExternResult<()> {
    let signal_payload: SignalPayload = signal
        .decode()
        .map_err(|err| wasm_error!(WasmErrorInner::Guest(err.into())))?;

    match signal_payload.clone() {
        SignalPayload::Ping { .. } => emit_signal(signal_payload),
        SignalPayload::Pong { .. } => emit_signal(signal_payload),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PingPayload {
    pub to_agents: Vec<AgentPubKey>,
    pub status: String,
    pub tz_utc_offset: Option<f32>,
}

/// Send a remote signal to the given users to check whether they are online
/// After this ping is sent, a pong is expected as soon as the agents receive the signal
#[hdk_extern]
pub fn ping(input: PingPayload) -> ExternResult<()> {
    let signal_payload = SignalPayload::Ping {
        from_agent: agent_info()?.agent_initial_pubkey,
        status: input.status,
        tz_utc_offset: input.tz_utc_offset,
    };

    let encoded_signal = ExternIO::encode(signal_payload)
        .map_err(|err| wasm_error!(WasmErrorInner::Guest(err.into())))?;

    send_remote_signal(encoded_signal, input.to_agents)
}

#[derive(Serialize, Deserialize, SerializedBytes, Debug, Clone)]
pub struct PongPayload {
    pub to_agents: Vec<AgentPubKey>,
    pub status: String,
    pub tz_utc_offset: Option<f32>,
}

#[hdk_extern]
fn pong(input: PongPayload) -> ExternResult<()> {
    let signal_payload = SignalPayload::Pong {
        from_agent: agent_info()?.agent_initial_pubkey,
        status: input.status,
        tz_utc_offset: input.tz_utc_offset,
    };

    let encoded_signal = ExternIO::encode(signal_payload)
        .map_err(|err| wasm_error!(WasmErrorInner::Guest(err.into())))?;

    send_remote_signal(encoded_signal, input.to_agents)
}
