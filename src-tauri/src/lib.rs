mod cli;

use serde::Serialize;
use sysinfo::System;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    os: &'static str,
    arch: &'static str,
    total_memory_gb: f64,
    cpu_count: usize,
    cpu_brand: String,
}

/// Datos del equipo para recomendar un modelo local adecuado (memoria y arquitectura).
#[tauri::command]
fn system_info() -> SystemInfo {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    SystemInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        total_memory_gb: sys.total_memory() as f64 / 1_073_741_824.0,
        cpu_count: sys.cpus().len(),
        cpu_brand: sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![system_info, cli::cli_status, cli::cli_run])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
