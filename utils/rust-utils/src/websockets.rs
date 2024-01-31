use std::sync::Arc;

use holochain_client::{
    AgentPubKey, AppInfo, AppRequest, AppResponse, ConductorApiError, ConductorApiResult,
    InstalledAppId, ZomeCall,
};
use holochain_conductor_api::{CellInfo, ClonedCell, ProvisionedCell};
use holochain_state::nonce::fresh_nonce;
use holochain_types::prelude::{
    CellId, CreateCloneCellPayload, DisableCloneCellPayload, EnableCloneCellPayload, ExternIO,
    FunctionName, RoleName, Signature, Timestamp, ZomeCallUnsigned, ZomeName,
};
use holochain_websocket::{connect, WebsocketConfig, WebsocketSender};
use lair_keystore_api::LairClient;

#[derive(Clone)]
pub struct AppAgentWebsocket {
    pub my_pub_key: AgentPubKey,
    app_ws: AppWebsocket,
    app_info: AppInfo,
    lair_client: LairClient,
}

impl AppAgentWebsocket {
    pub async fn connect(
        url: String,
        app_id: String,
        lair_client: LairClient,
    ) -> Result<Self, String> {
        let mut app_ws = AppWebsocket::connect(url)
            .await
            .map_err(|err| format!("{:?}", err))?;

        let app_info = app_ws
            .app_info(app_id.clone())
            .await
            .map_err(|err| format!("{:?}", err))?
            .ok_or(format!("Connection to app websocket failed."))?;

        Ok(AppAgentWebsocket {
            my_pub_key: app_info.agent_pub_key.clone(),
            app_ws,
            app_info,
            lair_client,
        })
    }

    pub async fn call_zome_fn(
        &mut self,
        role_name: RoleName,
        zome_name: ZomeName,
        fn_name: FunctionName,
        payload: ExternIO,
    ) -> Result<ExternIO, String> {
        let cell_id = self.get_cell_id_from_role_name(&role_name)?;

        let agent_pub_key = self.app_info.agent_pub_key.clone();

        let (nonce, expires_at) =
            fresh_nonce(Timestamp::now()).map_err(|err| format!("{:?}", err))?;

        let zome_call_unsigned = ZomeCallUnsigned {
            provenance: agent_pub_key,
            cell_id,
            zome_name,
            fn_name,
            payload,
            cap_secret: None,
            expires_at,
            nonce,
        };

        let signed_zome_call = sign_zome_call_with_client(zome_call_unsigned, &self.lair_client)
            .await
            .map_err(|err| format!("Failed to sign zome call: {}", err))?;

        let result = self
            .app_ws
            .call_zome(signed_zome_call)
            .await
            .map_err(|e| format!("Failed to call zome: {:?}", e))?;

        Ok(result)
    }

    fn get_cell_id_from_role_name(&self, role_name: &RoleName) -> Result<CellId, String> {
        if is_clone_id(role_name) {
            let base_role_name = get_base_role_name_from_clone_id(role_name);

            let Some(role_cells) = self.app_info.cell_info.get(&base_role_name) else {
               return Err(format!("No cell found with role_name {}", role_name));
            };

            let maybe_clone_cell: Option<ClonedCell> =
                role_cells.into_iter().find_map(|cell| match cell {
                    CellInfo::Cloned(cloned_cell) => {
                        if cloned_cell.clone_id.0.eq(role_name) {
                            Some(cloned_cell.clone())
                        } else {
                            None
                        }
                    }
                    _ => None,
                });

            let clone_cell = maybe_clone_cell
                .ok_or(format!("No clone cell found with clone id {}", role_name))?;
            return Ok(clone_cell.cell_id);
        } else {
            let Some(role_cells) = self.app_info.cell_info.get(role_name) else {
               return Err(format!("No cell found with role_name {}", role_name));
            };

            let maybe_provisioned: Option<ProvisionedCell> =
                role_cells.into_iter().find_map(|cell| match cell {
                    CellInfo::Provisioned(provisioned_cell) => Some(provisioned_cell.clone()),
                    _ => None,
                });

            let provisioned_cell = maybe_provisioned
                .ok_or(format!("No clone cell found with role id {}", role_name))?;
            return Ok(provisioned_cell.cell_id);
        }
    }
}

#[derive(Clone)]
pub struct AppWebsocket {
    tx: WebsocketSender,
}

fn is_clone_id(role_name: &RoleName) -> bool {
    role_name.as_str().contains(".")
}

fn get_base_role_name_from_clone_id(role_name: &RoleName) -> RoleName {
    RoleName::from(
        role_name
            .as_str()
            .split(".")
            .into_iter()
            .map(|s| s.to_string())
            .collect::<Vec<String>>()
            .first()
            .unwrap(),
    )
}

impl AppWebsocket {
    pub async fn connect(app_url: String) -> Result<Self, String> {
        let url = url::Url::parse(&app_url).unwrap();
        let websocket_config = Arc::new(WebsocketConfig::default().max_frame_size(64 << 20));
        let websocket_config = Arc::clone(&websocket_config);
        let (tx, mut rx) = connect(url.clone().into(), websocket_config)
            .await
            .map_err(|e| format!("Failed to connect to websocket: {}", e))?;

        // close receiver because it is not needed
        match rx.take_handle() {
            Some(h) => h.close(),
            None => (),
        }

        Ok(Self { tx })
    }

    pub async fn app_info(
        &mut self,
        app_id: InstalledAppId,
    ) -> ConductorApiResult<Option<AppInfo>> {
        let msg = AppRequest::AppInfo {
            installed_app_id: app_id,
        };
        let response = self.send(msg).await?;
        match response {
            AppResponse::AppInfo(app_info) => Ok(app_info),
            _ => unreachable!("Unexpected response {:?}", response),
        }
    }

    pub async fn call_zome(&mut self, msg: ZomeCall) -> ConductorApiResult<ExternIO> {
        let app_request = AppRequest::CallZome(Box::new(msg));
        let response = self.send(app_request).await?;

        match response {
            AppResponse::ZomeCalled(result) => Ok(*result),
            _ => unreachable!("Unexpected response {:?}", response),
        }
    }

    pub async fn create_clone_cell(
        &mut self,
        msg: CreateCloneCellPayload,
    ) -> ConductorApiResult<ClonedCell> {
        let app_request = AppRequest::CreateCloneCell(Box::new(msg));
        let response = self.send(app_request).await?;
        match response {
            AppResponse::CloneCellCreated(clone_cell) => Ok(clone_cell),
            _ => unreachable!("Unexpected response {:?}", response),
        }
    }

    pub async fn enable_clone_cell(
        &mut self,
        payload: EnableCloneCellPayload,
    ) -> ConductorApiResult<ClonedCell> {
        let msg = AppRequest::EnableCloneCell(Box::new(payload));
        let response = self.send(msg).await?;
        match response {
            AppResponse::CloneCellEnabled(enabled_cell) => Ok(enabled_cell),
            _ => unreachable!("Unexpected response {:?}", response),
        }
    }

    pub async fn disable_clone_cell(
        &mut self,
        msg: DisableCloneCellPayload,
    ) -> ConductorApiResult<()> {
        let app_request = AppRequest::DisableCloneCell(Box::new(msg));
        let response = self.send(app_request).await?;
        match response {
            AppResponse::CloneCellDisabled => Ok(()),
            _ => unreachable!("Unexpected response {:?}", response),
        }
    }

    async fn send(&mut self, msg: AppRequest) -> ConductorApiResult<AppResponse> {
        let response = self
            .tx
            .request(msg)
            .await
            .map_err(|err| ConductorApiError::WebsocketError(err))?;

        match response {
            AppResponse::Error(error) => Err(ConductorApiError::ExternalApiWireError(error)),
            _ => Ok(response),
        }
    }
}

/// Signs an unsigned zome call with the given LairClient
pub async fn sign_zome_call_with_client(
    zome_call_unsigned: ZomeCallUnsigned,
    client: &LairClient,
) -> Result<ZomeCall, String> {
    // sign the zome call
    let pub_key = zome_call_unsigned.provenance.clone();
    let mut pub_key_2 = [0; 32];
    pub_key_2.copy_from_slice(pub_key.get_raw_32());

    let data_to_sign = zome_call_unsigned
        .data_to_sign()
        .map_err(|e| format!("Failed to get data to sign from unsigned zome call: {}", e))?;

    let sig = client
        .sign_by_pub_key(pub_key_2.into(), None, data_to_sign)
        .await
        .map_err(|e| format!("Failed to sign zome call by pubkey: {}", e.str_kind()))?;

    let signature = Signature(*sig.0);

    let signed_zome_call = ZomeCall {
        cell_id: zome_call_unsigned.cell_id,
        zome_name: zome_call_unsigned.zome_name,
        fn_name: zome_call_unsigned.fn_name,
        payload: zome_call_unsigned.payload,
        cap_secret: zome_call_unsigned.cap_secret,
        provenance: zome_call_unsigned.provenance,
        nonce: zome_call_unsigned.nonce,
        expires_at: zome_call_unsigned.expires_at,
        signature,
    };

    return Ok(signed_zome_call);
}
