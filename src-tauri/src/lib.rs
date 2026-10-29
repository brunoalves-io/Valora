use serde::Serialize;
use std::path::Path;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
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

#[tauri::command]
async fn save_attachment_file(
    app: tauri::AppHandle,
    url: String,
    file_name: String,
) -> Result<Option<String>, String> {
    let parsed_url =
        Url::parse(&url).map_err(|_| "O endereço temporário do anexo é inválido.".to_string())?;

    let host = parsed_url.host_str().unwrap_or_default();
    let is_local = matches!(host, "localhost" | "127.0.0.1");

    if parsed_url.scheme() != "https" && !(parsed_url.scheme() == "http" && is_local) {
        return Err("O download do anexo exige uma conexão segura.".to_string());
    }

    if !parsed_url
        .path()
        .contains("/storage/v1/object/sign/transaction-attachments/")
    {
        return Err("O endereço recebido não pertence ao armazenamento de anexos do Valora.".to_string());
    }

    let safe_name = Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("anexo")
        .to_string();

    let mut dialog = app
        .dialog()
        .file()
        .set_title("Salvar anexo")
        .set_file_name(safe_name);

    if let Ok(download_dir) = app.path().download_dir() {
        dialog = dialog.set_directory(download_dir);
    }

    let Some(file_path) = dialog.blocking_save_file() else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|_| "Não foi possível acessar o local escolhido.".to_string())?;

    let response = reqwest::get(parsed_url)
        .await
        .map_err(|error| format!("Não foi possível baixar o anexo: {error}"))?
        .error_for_status()
        .map_err(|error| format!("O servidor recusou o download do anexo: {error}"))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Não foi possível ler o anexo baixado: {error}"))?;

    std::fs::write(&path, &bytes)
        .map_err(|error| format!("Não foi possível salvar o arquivo no Windows: {error}"))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_for_update,
            install_update,
            save_attachment_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Valora");
}
