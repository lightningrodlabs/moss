//! Spike: run a Holochain 0.7 conductor inside the Node/Electron process via
//! napi, with no admin/app websocket and no lair socket. Requests arrive as
//! msgpack-encoded `AdminRequest` bytes (the same encoding @holochain/client
//! puts on the wire) and responses leave as msgpack-encoded `AdminResponse`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use holochain::conductor::api::{
  AdminInterfaceApi, AdminRequest, AdminResponse, AppInterfaceApi, AppRequest, AppResponse,
  ZomeCallParamsSigned,
};
use holochain::conductor::{ConductorBuilder, ConductorHandle};
use holochain::prelude::{ExternIO, Timestamp, ZomeCallParams};
use holochain_conductor_api::CellInfo;
use holochain_conductor_api::config::conductor::{ConductorConfig, KeystoreConfig};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use tokio::sync::OnceCell;

static CONDUCTOR: OnceCell<ConductorHandle> = OnceCell::const_new();

/// Wall-clock milliseconds spent in each startup phase, so the host can see
/// which step dominates a launch.
#[napi(object)]
pub struct LaunchTimings {
  pub lair_ms: f64,
  /// Of `lair_ms`: starting lair's server (store open + runtime-secret unlock).
  /// Absent on a first run, when the lair config does not exist yet.
  pub lair_server_ms: Option<f64>,
  /// Of `lair_ms`: the client connecting and unlocking against that server.
  pub lair_connect_ms: Option<f64>,
  pub conductor_build_ms: f64,
  pub total_ms: f64,
}

fn to_napi<E: std::fmt::Display>(e: E) -> Error {
  Error::from_reason(e.to_string())
}

/// Opt-in log output to stderr, filtered by `RUST_LOG`, so the startup events
/// the conductor emits can be inspected.
fn init_tracing() {
  if std::env::var("RUST_LOG").is_ok() {
    let _ = tracing_subscriber::fmt()
      .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
      .with_writer(std::io::stderr)
      .try_init();
  }
}

#[napi(object)]
pub struct LaunchOptions {
  /// Conductor data root (Moss: `<profile>/data/conductor`).
  pub data_root: String,
  /// Directory holding `lair-keystore-config.yaml` (Moss: `<profile>/data/keystore`).
  /// Defaults to `data_root`.
  pub lair_root: Option<String>,
  pub passphrase: String,
  /// An existing conductor-config.yaml to start from. Its keystore and
  /// interfaces are replaced so the conductor stays socket-free.
  pub conductor_config_path: Option<String>,
}

#[napi]
pub async fn launch(opts: LaunchOptions) -> Result<LaunchTimings> {
  let LaunchOptions {
    data_root,
    lair_root,
    passphrase,
    conductor_config_path,
  } = opts;
  if CONDUCTOR.initialized() {
    return Err(Error::from_reason("conductor already launched"));
  }
  init_tracing();
  let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

  let start = Instant::now();
  let data_root_path = PathBuf::from(&data_root);
  std::fs::create_dir_all(&data_root_path).map_err(to_napi)?;
  let passphrase: lair_keystore_api::types::SharedLockedArray = Arc::new(Mutex::new(
    passphrase.into_bytes().into(),
  ));

  let lair_root_path = lair_root.map(PathBuf::from).unwrap_or_else(|| data_root_path.clone());
  let lair_config_path = lair_root_path.join("lair-keystore-config.yaml");
  let (lair, lair_server_ms, lair_connect_ms) = match std::fs::read(&lair_config_path) {
    // Same steps as `spawn_lair_keystore_in_proc`, timed separately.
    Ok(bytes) => {
      let config: lair_keystore_api::config::LairServerConfig = Arc::new(
        lair_keystore_api::config::LairServerConfigInner::from_bytes(&bytes).map_err(to_napi)?,
      );
      let connection_url = config.connection_url.clone();
      let mut server = lair_keystore::server::StandaloneServer::new(config)
        .await
        .map_err(to_napi)?;
      server.run(passphrase.clone()).await.map_err(to_napi)?;
      std::mem::forget(server);
      let server_ms = start.elapsed().as_secs_f64() * 1000.0;
      let lair = holochain_keystore::lair_keystore::spawn_lair_keystore(
        url2::Url2::from(connection_url),
        passphrase.clone(),
      )
      .await
      .map_err(to_napi)?;
      let connect_ms = start.elapsed().as_secs_f64() * 1000.0 - server_ms;
      (lair, Some(server_ms), Some(connect_ms))
    }
    Err(_) => {
      let lair = holochain_keystore::lair_keystore::spawn_lair_keystore_in_proc(
        &lair_config_path,
        passphrase.clone(),
      )
      .await
      .map_err(to_napi)?;
      (lair, None, None)
    }
  };
  let lair_ms = start.elapsed().as_secs_f64() * 1000.0;

  let mut config = match conductor_config_path {
    Some(path) => ConductorConfig::load_yaml(&PathBuf::from(path)).map_err(to_napi)?,
    None => ConductorConfig::default(),
  };
  config.data_root_path = Some(data_root_path.into());
  config.keystore = KeystoreConfig::LairServerInProc {
    lair_root: Some(lair_root_path.into()),
  };
  config.admin_interfaces = None;
  let conductor = ConductorBuilder::default()
    .passphrase(Some(passphrase))
    .config(config)
    .with_keystore(lair)
    .build()
    .await
    .map_err(to_napi)?;
  let total_ms = start.elapsed().as_secs_f64() * 1000.0;

  CONDUCTOR
    .set(conductor)
    .map_err(|_| Error::from_reason("conductor already launched"))?;

  Ok(LaunchTimings {
    lair_ms,
    lair_server_ms,
    lair_connect_ms,
    conductor_build_ms: total_ms - lair_ms,
    total_ms,
  })
}

#[napi]
pub async fn admin_request(request: Buffer) -> Result<Buffer> {
  let conductor = CONDUCTOR
    .get()
    .ok_or_else(|| Error::from_reason("conductor not launched"))?
    .clone();
  let request: std::result::Result<AdminRequest, _> =
    holochain_serialized_bytes::decode(request.as_ref());
  let response: AdminResponse = AdminInterfaceApi::new(conductor)
    .handle_request(request)
    .await
    .map_err(to_napi)?;
  let bytes = holochain_serialized_bytes::encode(&response).map_err(to_napi)?;
  Ok(bytes.into())
}

/// Dispatches a msgpack-encoded `AppRequest` for `installed_app_id` and
/// returns the msgpack-encoded `AppResponse`: the App API without a websocket.
#[napi]
pub async fn app_request(installed_app_id: String, request: Buffer) -> Result<Buffer> {
  let conductor = CONDUCTOR
    .get()
    .ok_or_else(|| Error::from_reason("conductor not launched"))?
    .clone();
  let request: std::result::Result<AppRequest, _> =
    holochain_serialized_bytes::decode(request.as_ref());
  let response: AppResponse = AppInterfaceApi::new(conductor)
    .handle_request(installed_app_id, request)
    .await
    .map_err(to_napi)?;
  let bytes = holochain_serialized_bytes::encode(&response).map_err(to_napi)?;
  Ok(bytes.into())
}

/// Signs a zome call with the in-process keystore as the cell's agent and
/// dispatches it through the App API, as the host would on behalf of an applet.
/// `payload` and the return value are msgpack bytes of the zome fn input/output.
#[napi]
pub async fn call_zome(
  installed_app_id: String,
  role_name: String,
  zome_name: String,
  fn_name: String,
  payload: Buffer,
) -> Result<Buffer> {
  let conductor = CONDUCTOR
    .get()
    .ok_or_else(|| Error::from_reason("conductor not launched"))?
    .clone();
  let app_info = conductor
    .get_app_info(&installed_app_id)
    .await
    .map_err(to_napi)?
    .ok_or_else(|| Error::from_reason("app not installed"))?;
  let cell_id = app_info
    .cell_info
    .get(&role_name)
    .and_then(|cells| {
      cells.iter().find_map(|c| match c {
        CellInfo::Provisioned(cell) => Some(cell.cell_id.clone()),
        _ => None,
      })
    })
    .ok_or_else(|| Error::from_reason("no provisioned cell for role"))?;

  let (nonce, expires_at) = holochain_nonce::fresh_nonce(Timestamp::now()).map_err(to_napi)?;
  let params = ZomeCallParams {
    provenance: cell_id.agent_pubkey().clone(),
    cell_id,
    zome_name: zome_name.into(),
    fn_name: fn_name.into(),
    cap_secret: None,
    payload: ExternIO(payload.to_vec()),
    nonce,
    expires_at,
  };
  let (bytes, hash) = params.serialize_and_hash().map_err(to_napi)?;
  let signer: [u8; 32] = params
    .provenance
    .get_raw_32()
    .try_into()
    .map_err(|_| Error::from_reason("invalid provenance"))?;
  let signature = conductor
    .keystore()
    .lair_client()
    .sign_by_pub_key(signer.into(), None, hash.into())
    .await
    .map_err(to_napi)?;
  let signed = ZomeCallParamsSigned {
    bytes: bytes.into(),
    signature: (*signature.0).into(),
  };

  let response = AppInterfaceApi::new(conductor)
    .handle_request(installed_app_id, Ok(AppRequest::CallZome(Box::new(signed))))
    .await
    .map_err(to_napi)?;
  match response {
    AppResponse::ZomeCalled(output) => Ok(output.0.into()),
    other => Err(Error::from_reason(format!("{other:?}"))),
  }
}

#[napi]
pub async fn shutdown() -> Result<()> {
  if let Some(conductor) = CONDUCTOR.get() {
    conductor.clone().shutdown().await.map_err(to_napi)?.map_err(to_napi)?;
  }
  Ok(())
}
