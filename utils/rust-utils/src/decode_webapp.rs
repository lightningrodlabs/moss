use holochain_types::app::AppBundle;
use holochain_types::web_app::WebAppBundle;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

#[napi]
pub async fn save_happ_or_webhapp(
    happ_or_web_happ_path: String,
    uis_dir: String,
    happs_dir: String,
) -> napi::Result<String> {
    let happ_or_webhapp_bytes = fs::read(happ_or_web_happ_path)?;

    let (app_bundle, maybe_ui_and_webhapp_hash) = match WebAppBundle::decode(&happ_or_webhapp_bytes)
    {
        Ok(web_app_bundle) => {
            let mut hasher = Sha256::new();
            hasher.update(happ_or_webhapp_bytes);
            let web_happ_hash = hex::encode(hasher.finalize());
            // extracting ui.zip bytes
            let web_ui_zip_bytes = web_app_bundle.web_ui_zip_bytes().await.map_err(|e| {
                napi::Error::from_reason(format!("Failed to extract ui zip bytes: {}", e))
            })?;

            let mut hasher = Sha256::new();
            hasher.update(web_ui_zip_bytes.clone().into_owned().into_inner());
            let ui_hash = hex::encode(hasher.finalize());

            let ui_target_dir = PathBuf::from(uis_dir).join(ui_hash.clone()).join("assets");
            if !path_exists(&ui_target_dir) {
                fs::create_dir_all(&ui_target_dir)?;
            }

            let ui_zip_path = PathBuf::from(ui_target_dir.clone()).join("ui.zip");

            // unzip and store UI
            fs::write(
                ui_zip_path.clone(),
                web_ui_zip_bytes.into_owned().into_inner(),
            )
            .map_err(|e| {
                napi::Error::from_reason(format!("Failed to write Web UI Zip file: {}", e))
            })?;

            let file = fs::File::open(ui_zip_path.clone()).map_err(|e| {
                napi::Error::from_reason(format!("Failed to read Web UI Zip file: {}", e))
            })?;

            unzip_file(file, ui_target_dir.into())
                .map_err(|e| napi::Error::from_reason(format!("Failed to unzip ui.zip: {}", e)))?;

            fs::remove_file(ui_zip_path).map_err(|e| {
                napi::Error::from_reason(format!("Failed to remove ui.zip after unzipping: {}", e))
            })?;

            // extracting happ bundle
            let app_bundle = web_app_bundle.happ_bundle().await.map_err(|e| {
                napi::Error::from_reason(format!(
                    "Failed to get happ bundle from webapp bundle bytes: {}",
                    e
                ))
            })?;

            (app_bundle, Some((ui_hash, web_happ_hash)))
        }
        Err(_) => {
            let app_bundle = AppBundle::decode(&happ_or_webhapp_bytes).map_err(|e| {
                napi::Error::from_reason(format!("Failed to decode happ file: {}", e))
            })?;
            (app_bundle, None)
        }
    };

    let mut hasher = Sha256::new();
    let app_bundle_bytes = app_bundle
        .encode()
        .map_err(|e| napi::Error::from_reason(format!("Failed to encode happ to bytes: {}", e)))?;
    hasher.update(app_bundle_bytes);
    let happ_hash = hex::encode(hasher.finalize());
    let happ_path = PathBuf::from(happs_dir).join(format!("{}.happ", happ_hash));

    app_bundle
        .write_to_file(&happ_path)
        .await
        .map_err(|e| napi::Error::from_reason(format!("Failed to write .happ file: {}", e)))?;

    let happ_path_string = happ_path.as_os_str().to_str();
    match happ_path_string {
        Some(str) => match maybe_ui_and_webhapp_hash {
            Some((ui_hash, web_happ_hash)) => Ok(format!(
                "{}${}${}${}",
                str.to_string(),
                happ_hash,
                ui_hash,
                web_happ_hash,
            )),
            None => Ok(format!("{}${}", str.to_string(), happ_hash)),
        },
        None => Err(napi::Error::from_reason(
            "Failed to convert happ path to string.",
        )),
    }
}

/// Checks that the happ or webhapp is of the correct format
#[napi]
pub async fn validate_happ_or_webhapp(happ_or_webhapp_bytes: Vec<u8>) -> napi::Result<String> {
    let (app_bundle, maybe_ui_and_webhapp_hash) = match WebAppBundle::decode(&happ_or_webhapp_bytes)
    {
        Ok(web_app_bundle) => {
            let mut hasher = Sha256::new();
            hasher.update(happ_or_webhapp_bytes);
            let web_happ_hash = hex::encode(hasher.finalize());
            // extracting ui.zip bytes
            let web_ui_zip_bytes = web_app_bundle.web_ui_zip_bytes().await.map_err(|e| {
                napi::Error::from_reason(format!("Failed to extract ui zip bytes: {}", e))
            })?;

            let mut hasher = Sha256::new();
            hasher.update(web_ui_zip_bytes.clone().into_owned().into_inner());
            let ui_hash = hex::encode(hasher.finalize());

            // extracting happ bundle
            let app_bundle = web_app_bundle.happ_bundle().await.map_err(|e| {
                napi::Error::from_reason(format!(
                    "Failed to get happ bundle from webapp bundle bytes: {}",
                    e
                ))
            })?;

            (app_bundle, Some((ui_hash, web_happ_hash)))
        }
        Err(_) => {
            let app_bundle = AppBundle::decode(&happ_or_webhapp_bytes).map_err(|e| {
                napi::Error::from_reason(format!("Failed to decode happ file: {}", e))
            })?;
            (app_bundle, None)
        }
    };

    let mut hasher = Sha256::new();
    let app_bundle_bytes = app_bundle
        .encode()
        .map_err(|e| napi::Error::from_reason(format!("Failed to encode happ to bytes: {}", e)))?;
    hasher.update(app_bundle_bytes);
    let happ_hash = hex::encode(hasher.finalize());

    match maybe_ui_and_webhapp_hash {
        Some((ui_hash, web_happ_hash)) => {
            Ok(format!("{}${}${}", happ_hash, ui_hash, web_happ_hash))
        }
        None => Ok(format!("{}", happ_hash)),
    }
}

pub fn path_exists(path: &PathBuf) -> bool {
    std::path::Path::new(path).exists()
}

pub fn unzip_file(reader: fs::File, outpath: PathBuf) -> Result<(), String> {
    let mut archive = match zip::ZipArchive::new(reader) {
        Ok(a) => a,
        Err(e) => return Err(format!("Failed to unpack zip archive: {}", e)),
    };

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).unwrap();
        let outpath = match file.enclosed_name() {
            Some(path) => outpath.join(path).to_owned(),
            None => continue,
        };

        if (&*file.name()).ends_with('/') {
            fs::create_dir_all(&outpath).unwrap();
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(&p).unwrap();
                }
            }
            let mut outfile = fs::File::create(&outpath).unwrap();
            std::io::copy(&mut file, &mut outfile).unwrap();
        }
    }

    Ok(())
}
