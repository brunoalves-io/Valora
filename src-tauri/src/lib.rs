use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResult {
    enabled: bool,
    current_version: String,
    available: bool,
    version: Option<String>,
}

fn updater_config() -> Option<(&'static str, &'static str)> {
    let pubkey = option_env!("VALORA_UPDATER_PUBLIC_KEY").unwrap_or("").trim();
    let endpoint = option_env!("VALORA_UPDATER_ENDPOINT").unwrap_or("").trim();

    if pubkey.is_empty() || endpoint.is_empty() {
        return None;
    }

    Some((pubkey, endpoint))
}

fn updater_endpoint(value: &str) -> Result<Url, String> {
    value
        .parse::<Url>()
        .map_err(|_| "O endereço de atualização do Valora é inválido.".to_string())
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();

    let Some((pubkey, endpoint)) = updater_config() else {
        return Ok(UpdateCheckResult {
            enabled: false,
            current_version,
            available: false,
            version: None,
        });
    };

    let updater = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![updater_endpoint(endpoint)?])
        .map_err(|error| format!("Não foi possível configurar as atualizações: {error}"))?
        .build()
        .map_err(|error| format!("Não foi possível iniciar o atualizador: {error}"))?;

    let update = updater
        .check()
        .await
        .map_err(|error| format!("Não foi possível verificar atualizações: {error}"))?;

    Ok(UpdateCheckResult {
        enabled: true,
        current_version,
        available: update.is_some(),
        version: update.map(|item| item.version.to_string()),
    })
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let Some((pubkey, endpoint)) = updater_config() else {
        return Err("As atualizações automáticas ainda não estão ativadas nesta versão.".to_string());
    };

    let updater = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![updater_endpoint(endpoint)?])
        .map_err(|error| format!("Não foi possível configurar as atualizações: {error}"))?
        .build()
        .map_err(|error| format!("Não foi possível iniciar o atualizador: {error}"))?;

    let Some(update) = updater
        .check()
        .await
        .map_err(|error| format!("Não foi possível verificar a atualização: {error}"))?
    else {
        return Err("Nenhuma atualização está disponível agora.".to_string());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Não foi possível instalar a atualização: {error}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![check_for_update, install_update])
        .run(tauri::generate_context!())
        .expect("error while running Valora");
}
