use std::{
    collections::{BTreeMap, HashMap},
    io::Write,
    path::PathBuf,
    sync::Arc,
};

use appstore_types::AppEntry;
use devhub_types::{
    encode_bundle,
    happ_entry_types::{GUIReleaseEntry, HappManifest},
    DevHubResponse, DnaVersionEntry, FileEntry, GetEntityInput, HappReleaseEntry,
};
use essence::EssenceResponse;
use futures::lock::Mutex;
use hc_crud::Entity;
use holochain::{
    conductor::api::{CellInfo, ClonedCell, ProvisionedCell},
    prelude::{
        kitsune_p2p::dependencies::kitsune_p2p_types::dependencies::lair_keystore_api::LairClient,
        ActionHash, ActionHashB64, AgentPubKeyB64, AppBundleSource, CellId, CreateCloneCellPayload,
        DisableCloneCellPayload, DnaHash, DnaHashB64, EnableCloneCellPayload, ExternIO,
        FunctionName, HumanTimestamp, MembraneProof, RoleName, Serialize, SerializedBytes,
        Timestamp, UnsafeBytes, ZomeCallUnsigned, ZomeName,
    },
};
use holochain_client::{
    AdminWebsocket, AgentPubKey, AppInfo, AppRequest, AppResponse, AppStatusFilter,
    ConductorApiError, ConductorApiResult, InstallAppPayload, InstalledAppId, ZomeCall,
};
use holochain_types::prelude::{AnyDhtHash, AnyDhtHashB64, EntryHash};
use holochain_websocket::{connect, WebsocketConfig, WebsocketSender};
use mere_memory_types::{MemoryBlockEntry, MemoryEntry};
use portal_types::{DnaZomeFunction, HostEntry, RemoteCallDetails};
use serde::{de::DeserializeOwned, Deserialize};

use crate::websockets::AppAgentWebsocket;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HappBundle {
    pub manifest: HappManifest,
    pub resources: BTreeMap<String, Vec<u8>>,
}

/// Fetch and assemble a happ from a devhub host
pub async fn fetch_assemble_and_store_happ(
    app_agent_websocket: &mut AppAgentWebsocket,
    host: AgentPubKey,
    devhub_happ_library_dna_hash: DnaHash,
    happ_release_hash: String,
    storage_dir: PathBuf,
) -> Result<(), String> {
    let file_path = storage_dir.join(format!("{}.happ", happ_release_hash));
    if file_path.exists() {
        return Ok(());
    }
    let happ_release_action_hash = ActionHash::from(
        ActionHashB64::from_b64_str(happ_release_hash.as_str()).map_err(|e| {
            format!(
                "Failed to convert action hash string to ActionHashB64: {}",
                e
            )
        })?,
    );

    let happ_release_entry_entity: Entity<HappReleaseEntry> = portal_remote_call(
        app_agent_websocket,
        host.clone(),
        devhub_happ_library_dna_hash.clone(),
        String::from("happ_library"),
        String::from("get_happ_release"),
        GetEntityInput {
            id: happ_release_action_hash.clone(),
        },
    )
    .await
    .map_err(|e| format!("{}", e))?;
    // 1. Get all .dna files
    let mut dna_resources: BTreeMap<String, Vec<u8>> = BTreeMap::new();

    let mut happ_release_entry = happ_release_entry_entity.content;

    for (i, dna_ref) in happ_release_entry.dnas.iter().enumerate() {
        let dna_path = format!("./{}.dna", dna_ref.role_name);

        println!(
            "Assembling data for dna with role_name: {}",
            dna_ref.role_name
        );
        println!("DNA path: {}", dna_path);

        let dna_version: Entity<DnaVersionEntry> = portal_remote_call(
            app_agent_websocket,
            host.clone(),
            devhub_happ_library_dna_hash.clone(),
            String::from("happ_library"),
            String::from("get_dna_version"),
            GetEntityInput {
                id: dna_ref.version.to_owned(),
            },
        )
        .await
        .map_err(|e| format!("Failed to get dna version: {}", e))?;

        let mut resources: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        let mut integrity_zomes: Vec<BundleIntegrityZomeInfo> = vec![];
        let mut coordinator_zomes: Vec<BundleZomeInfo> = vec![];

        for zome_ref in dna_version.content.integrity_zomes {
            let wasm_bytes = fetch_mere_memory(
                app_agent_websocket,
                host.clone(),
                "dnarepo",
                devhub_happ_library_dna_hash.clone(),
                zome_ref.resource,
            )
            .await
            .map_err(|e| format!("Failed to get zome from mere memory: {}", e))?;

            let path = format!("./{}.wasm", zome_ref.name);

            integrity_zomes.push(BundleIntegrityZomeInfo {
                name: zome_ref.name.clone(),
                bundled: path.clone(),
                hash: None,
            });

            resources.insert(path, wasm_bytes);
        }

        for zome_ref in dna_version.content.zomes {
            let wasm_bytes = fetch_mere_memory(
                app_agent_websocket,
                host.clone(),
                "dnarepo",
                devhub_happ_library_dna_hash.clone(),
                zome_ref.resource,
            )
            .await
            .map_err(|e| format!("Failed to get zome from mere memory: {}", e))?;

            let path = format!("./{}.wasm", zome_ref.name);

            coordinator_zomes.push(BundleZomeInfo {
                name: zome_ref.name.clone(),
                bundled: path.clone(),
                hash: None,
                dependencies: zome_ref
                    .dependencies
                    .iter()
                    .map(|name| DependencyRef {
                        name: name.to_owned(),
                    })
                    .collect(),
            });

            resources.insert(path, wasm_bytes);
        }

        let dna_bundle = DnaBundle {
            manifest: Manifest {
                manifest_version: "1".into(),
                name: dna_ref.role_name.clone(),
                integrity: IntegrityZomes {
                    origin_time: dna_version.content.origin_time.clone(),
                    network_seed: dna_version.content.network_seed.clone(),
                    properties: dna_version.content.properties.clone(),
                    zomes: integrity_zomes,
                },
                coordinator: CoordinatorZomes {
                    zomes: coordinator_zomes,
                },
            },
            resources,
        };

        let dna_pack_bytes = encode_bundle(dna_bundle).map_err(|e| {
            format!(
                "Failed to encode bundle for dna {}: {}",
                dna_ref.role_name, e
            )
        })?;

        dna_resources.insert(dna_path.clone(), dna_pack_bytes);
        happ_release_entry.manifest.roles[i].dna.bundled = dna_path;
    }

    // println!("happ manifest: {:?}", happ_release_entry.manifest);
    // println!("dna_resources keys: {:?}", dna_resources.keys());

    let happ_bundle = HappBundle {
        manifest: happ_release_entry.manifest,
        resources: dna_resources,
    };

    let happ_pack_bytes =
        encode_bundle(happ_bundle).map_err(|e| format!("Failed to encode happ bundle: {}", e))?;

    // Store to storage directory
    let mut file = std::fs::File::create(file_path)
        .map_err(|e| format!("Failed to create file at the given file path: {}", e))?;
    file.write_all(&happ_pack_bytes)
        .map_err(|e| format!("Failed to write happ bytes to file: {}", e))?;
    Ok(())
}

pub async fn fetch_and_store_ui_from_host(
    app_agent_websocket: &mut AppAgentWebsocket,
    host: AgentPubKey,
    gui_release_hash: String,
    devhub_dna: DnaHash,
    uis_storage_dir: PathBuf,
) -> Result<(), String> {
    let assets_dir = uis_storage_dir.join(&gui_release_hash).join("assets");
    if !assets_dir.exists() {
        std::fs::create_dir_all(&assets_dir)
            .map_err(|e| format!("Failed to create directory to store UI assets in: {}", e))?;
    } else {
        // We assume that in this case the UI has already been installed earlier
        // so no need to fetch it again
        return Ok(());
    }

    let gui_release_action_hash = ActionHash::from(
        ActionHashB64::from_b64_str(gui_release_hash.as_str()).map_err(|e| {
            format!(
                "Failed to convert action hash string to ActionHashB64: {}",
                e
            )
        })?,
    );
    let gui_release_entry_entity: Entity<GUIReleaseEntry> = portal_remote_call(
        app_agent_websocket,
        host.clone(),
        devhub_dna.clone(),
        String::from("happ_library"),
        String::from("get_gui_release"),
        GetEntityInput {
            id: gui_release_action_hash.clone(),
        },
    )
    .await
    .map_err(|e| format!("Failed to get gui release entry: {}", e))?;

    let web_asset_file: Entity<FileEntry> = portal_remote_call(
        app_agent_websocket,
        host.clone(),
        devhub_dna.clone(),
        String::from("happ_library"),
        String::from("get_webasset_file"),
        GetEntityInput {
            id: gui_release_entry_entity.content.web_asset_id,
        },
    )
    .await
    .map_err(|e| format!("Failed to get webasset file: {}", e))?;

    let ui_bytes = fetch_mere_memory(
        app_agent_websocket,
        host.clone(),
        "web_assets",
        devhub_dna.clone(),
        web_asset_file.content.mere_memory_addr,
    )
    .await
    .map_err(|e| format!("Failed to get webasset file: {}", e))?;

    let ui_zip_path = assets_dir.join("ui.zip");

    std::fs::write(ui_zip_path.clone(), ui_bytes)
        .map_err(|e| format!("Failed to write ui.zip: {}", e))?;

    let file = std::fs::File::open(ui_zip_path.clone())
        .map_err(|e| format!("Failed to open ui.zip: {}", e))?;

    crate::decode_webapp::unzip_file(file, assets_dir.clone())?;

    std::fs::remove_file(ui_zip_path)
        .map_err(|e| format!("Failed to remove ui.zip after extraction: {}", e))?;

    Ok(())
}

// async fn get_available_hosts_for_zome_function(
//     app_store_client: &mut AppAgentWebsocket,
//     devhub_dna: &DnaHash,
//     zome_name: ZomeName,
//     zome_function: FunctionName,
// ) -> Result<Vec<AgentPubKey>, String> {
//     let hosts: EssenceResponse<Vec<hc_crud::Entity<HostEntry>>, Metadata, ()> = app_store_client
//         .call_zome_fn(
//             RoleName::from("portal"),
//             ZomeName::from("portal_api"),
//             FunctionName::from("get_hosts_for_zome_function"),
//             ExternIO::encode(DnaZomeFunction {
//                 dna: devhub_dna.clone(),
//                 zome: zome_name,
//                 function: zome_function,
//             })?,
//         )
//         .await?
//         .decode()?;

//     let hosts = hosts.as_result()?;
//     let hosts: Vec<AgentPubKey> = hosts.into_iter().map(|e| e.content.author).collect();

//     let mut handles = Vec::new();

//     for host in hosts.iter() {
//         let mut client = app_store_client.clone();
//         let host = host.clone();
//         handles.push(tokio::time::timeout(
//             tokio::time::Duration::from_secs(3),
//             tauri::async_runtime::spawn(async move { is_host_available(&mut client, &host).await }),
//         ));
//     }

//     let mut available_hosts = Vec::new();

//     for (i, handle) in handles.into_iter().enumerate() {
//         if let Ok(Ok(Ok(true))) = handle.await {
//             available_hosts.push(hosts[i].clone());
//         }
//     }

//     Ok(available_hosts)
// }

#[derive(Debug, Serialize, Deserialize)]
pub struct Metadata {
    pub composition: String,
}
// async fn is_host_available(
//     app_store_client: &mut AppAgentWebsocket,
//     host: &AgentPubKey,
// ) -> WeResult<bool> {
//     let response: EssenceResponse<bool, Metadata, ()> = app_store_client
//         .call_zome_fn(
//             RoleName::from("portal"),
//             ZomeName::from("portal_api"),
//             FunctionName::from("ping"),
//             ExternIO::encode(host.clone())?,
//         )
//         .await?
//         .decode()?;

//     let r: bool = response.as_result()?;

//     Ok(r)
// }

#[derive(Debug, Serialize, Deserialize)]
pub struct CustomRemoteCallInput<T: Serialize + core::fmt::Debug> {
    host: AgentPubKey,
    call: RemoteCallDetails<String, String, T>,
}

/// Wrapper for remote calls through the portal_api
async fn portal_remote_call<
    T: Serialize + core::fmt::Debug,
    U: Serialize + DeserializeOwned + core::fmt::Debug,
>(
    app_agent_client: &mut AppAgentWebsocket,
    host: AgentPubKey,
    dna: DnaHash,
    zome: String,
    function: String,
    payload: T,
) -> Result<U, String> {
    let input = CustomRemoteCallInput {
        host,
        call: RemoteCallDetails {
            dna,
            zome: zome.clone(),
            function: function.clone(),
            payload,
        },
    };

    let result = app_agent_client
        .call_zome_fn(
            RoleName::from("portal"),
            ZomeName::from("portal_api"),
            FunctionName::from("custom_remote_call"),
            ExternIO::encode(input)?,
        )
        .await
        .map_err(|e| e.to_string())?;

    let response: DevHubResponse<DevHubResponse<U>> = result.decode().map_err(|e| {
        format!(
            "Error decoding the remote call response for zome '{}' and function '{}': {}",
            zome, function, e
        )
    })?;

    let inner_response = match response {
        DevHubResponse::Success(pack) => pack.payload,
        DevHubResponse::Failure(error) => {
            println!("Errorpayload: {:?}", error.payload);
            return Err(format!("Received ErrorPayload: {:?}", error.payload));
        }
    };

    let bytes = inner_response
        .as_result()
        .map_err(|e| format!("Failed to get content from DevHubResponse: {}", e))?;

    Ok(bytes)
}

/// Fetching and combining bytes by mere_memory_address
async fn fetch_mere_memory(
    app_agent_client: &mut AppAgentWebsocket,
    host: AgentPubKey,
    dna_name: &str,
    devhub_happ_library_dna_hash: DnaHash,
    memory_address: EntryHash,
) -> Result<Vec<u8>, String> {
    // 1. get MemoryEntry
    let memory_entry: MemoryEntry = portal_remote_call(
        app_agent_client,
        host.clone(),
        devhub_happ_library_dna_hash.clone(),
        String::from("happ_library"),
        format!("{}_get_memory", dna_name),
        memory_address,
    )
    .await?;

    let mut memory_blocks: Vec<MemoryBlockEntry> = Vec::new();
    // 2. Assemble all MemoryEntryBlock's
    for block_address in memory_entry.block_addresses {
        let memory_block_entry: MemoryBlockEntry = portal_remote_call(
            app_agent_client,
            host.clone(),
            devhub_happ_library_dna_hash.clone(),
            String::from("happ_library"),
            format!("{}_get_memory_block", dna_name),
            block_address,
        )
        .await?;

        memory_blocks.push(memory_block_entry);
    }

    // 3. Sort and combine them
    memory_blocks.sort_by(|a, b| a.sequence.position.cmp(&b.sequence.position));

    let combined_memory = memory_blocks
        .into_iter()
        .map(|m| m.bytes)
        .flatten()
        .collect::<Vec<u8>>();

    Ok(combined_memory)
}

// ------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DependencyRef {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BundleIntegrityZomeInfo {
    pub name: String,
    pub bundled: String,

    // Optional fields
    pub hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BundleZomeInfo {
    pub name: String,
    pub bundled: String,
    pub dependencies: Vec<DependencyRef>,

    // Optional fields
    pub hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Manifest {
    pub manifest_version: String,
    pub name: String,
    pub integrity: IntegrityZomes,
    pub coordinator: CoordinatorZomes,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IntegrityZomes {
    origin_time: HumanTimestamp,
    zomes: Vec<BundleIntegrityZomeInfo>,

    // Optional fields
    pub network_seed: Option<String>,
    pub properties: Option<BTreeMap<String, serde_yaml::Value>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CoordinatorZomes {
    zomes: Vec<BundleZomeInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Bundle {
    pub manifest: Manifest,
    pub resources: BTreeMap<String, Vec<u8>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DnaBundle {
    pub manifest: Manifest,
    pub resources: BTreeMap<String, Vec<u8>>,
}
