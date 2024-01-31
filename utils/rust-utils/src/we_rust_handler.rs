#![deny(clippy::all)]

use holochain_client::AdminWebsocket;
use holochain_types::prelude::{Signature, ZomeCallUnsigned};
use lair_keystore_api::{dependencies::url::Url, ipc_keystore::ipc_keystore_connect, LairClient};
use napi::Result;
use sodoken::BufRead;
use std::ops::Deref;

use crate::types::*;

struct WeRustHandler {
    lair_client: LairClient,
    admin_ws: AdminWebsocket,
    app_port: u64,
}

impl WeRustHandler {
    /// Connect to lair keystore
    pub async fn new(
        keystore_url: String,
        admin_port: u64,
        app_port: u64,
        passphrase: String,
    ) -> Self {
        let connection_url_parsed = Url::parse(keystore_url.deref()).unwrap();
        let passphrase_bufread: BufRead = passphrase.as_bytes().into();

        // TODO graceful error handling below
        let lair_client = ipc_keystore_connect(connection_url_parsed, passphrase_bufread)
            .await
            .unwrap();

        let admin_ws = AdminWebsocket::connect(format!("ws://127.0.0.1:{}", admin_port))
            .await
            .unwrap();

        Self {
            lair_client,
            admin_ws,
            app_port,
        }
    }

    /// Sign a zome call
    pub async fn sign_zome_call(
        &self,
        zome_call_unsigned_js: ZomeCallUnsignedNapi,
    ) -> Result<ZomeCallNapi> {
        let zome_call_unsigned: ZomeCallUnsigned = zome_call_unsigned_js.clone().into();
        let pub_key = zome_call_unsigned.provenance.clone();
        let mut pub_key_2 = [0; 32];
        pub_key_2.copy_from_slice(pub_key.get_raw_32());

        let data_to_sign = zome_call_unsigned.data_to_sign().unwrap();

        let sig = self
            .lair_client
            .sign_by_pub_key(pub_key_2.into(), None, data_to_sign)
            .await
            .unwrap();

        let signature = Signature(*sig.0);

        let signed_zome_call = ZomeCallNapi {
            cell_id: zome_call_unsigned_js.cell_id,
            zome_name: zome_call_unsigned.zome_name.to_string(),
            fn_name: zome_call_unsigned.fn_name.0,
            payload: zome_call_unsigned_js.payload,
            cap_secret: zome_call_unsigned_js.cap_secret,
            provenance: zome_call_unsigned_js.provenance,
            nonce: zome_call_unsigned_js.nonce,
            expires_at: zome_call_unsigned_js.expires_at,
            signature: signature.0.to_vec(),
        };

        Ok(signed_zome_call)
    }
}

#[napi(js_name = "WeRustHandler")]
pub struct JsWeRustHandler {
    we_rust_handler: Option<WeRustHandler>,
}

#[napi]
impl JsWeRustHandler {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            we_rust_handler: None,
        }
    }

    #[napi]
    pub async fn connect(
        keystore_url: String,
        admin_port: i32,
        app_port: i32,
        passphrase: String,
    ) -> Self {
        let we_rust_handler =
            WeRustHandler::new(keystore_url, admin_port as u64, app_port as u64, passphrase).await;

        JsWeRustHandler {
            we_rust_handler: Some(we_rust_handler),
        }
    }

    #[napi]
    pub async fn sign_zome_call(
        &self,
        zome_call_unsigned_js: ZomeCallUnsignedNapi,
    ) -> Result<ZomeCallNapi> {
        self.we_rust_handler
            .as_ref()
            .ok_or(napi::Error::from_reason(format!(
                "Failed to get rust handler reference"
            )))?
            .sign_zome_call(zome_call_unsigned_js)
            .await
    }
}
