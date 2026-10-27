//! Puente con los CLI oficiales de suscripción: Claude Code (Claude Pro/Max),
//! Codex CLI (ChatGPT Plus/Pro) y Gemini CLI (cuenta de Google).
//! Cada CLI usa la sesión que el usuario inició en él; AI3D nunca ve credenciales.
//! Se ejecutan en una carpeta temporal, sin herramientas que corran comandos ni escriban archivos.

use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const TIMEOUT: Duration = Duration::from_secs(300);

/// Las apps de escritorio en macOS/Linux no heredan el PATH de la terminal;
/// se toma una vez del shell de inicio de sesión del usuario.
fn user_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let inherited = std::env::var("PATH").unwrap_or_default();
        if cfg!(windows) {
            return inherited;
        }
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let from_shell = std::process::Command::new(shell)
            .args(["-l", "-c", "printf %s \"$PATH\""])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .unwrap_or_default();
        let home = std::env::var("HOME").unwrap_or_default();
        let extra = [format!("{home}/.local/bin"), "/opt/homebrew/bin".into(), "/usr/local/bin".into()];
        [from_shell, extra.join(":"), inherited].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(":")
    })
}

fn binary(provider: &str) -> Result<&'static str, String> {
    match provider {
        "claude" => Ok("claude"),
        "codex" => Ok("codex"),
        "gemini" => Ok("gemini"),
        _ => Err(format!("CLI desconocido: {provider}")),
    }
}

fn resolve(name: &str) -> Option<PathBuf> {
    which::which_in(name, Some(user_path()), std::env::temp_dir()).ok()
}

fn command(bin: &Path, cwd: &Path) -> Command {
    let mut cmd = Command::new(bin);
    cmd.current_dir(cwd)
        .env("PATH", user_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    id: &'static str,
    installed: bool,
    path: Option<String>,
    version: Option<String>,
}

#[tauri::command]
pub async fn cli_status() -> Vec<CliInfo> {
    let mut out = Vec::new();
    for id in ["claude", "codex", "gemini"] {
        let path = resolve(id);
        let mut version = None;
        if let Some(p) = &path {
            let mut cmd = command(p, &std::env::temp_dir());
            cmd.arg("--version").stdin(Stdio::null());
            if let Ok(Ok(o)) = tokio::time::timeout(Duration::from_secs(15), cmd.output()).await {
                version = String::from_utf8_lossy(&o.stdout).lines().next().map(|l| l.trim().to_string());
            }
        }
        out.push(CliInfo { id, installed: path.is_some(), path: path.map(|p| p.display().to_string()), version });
    }
    out
}

struct TempDir(PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn first_json_field(stdout: &str, keys: &[&str]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    keys.iter().find_map(|k| v.get(*k).and_then(|x| x.as_str()).map(str::to_string))
}

/// Ejecuta una consulta de una sola vuelta y devuelve el texto de la respuesta.
#[tauri::command]
pub async fn cli_run(provider: String, system: String, prompt: String, image_jpeg_base64: Option<String>, model: Option<String>) -> Result<String, String> {
    let name = binary(&provider)?;
    let bin = resolve(name).ok_or_else(|| format!("No se encontró «{name}». Instálalo y vuelve a intentarlo."))?;

    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = TempDir(std::env::temp_dir().join(format!("ai3d-{stamp}")));
    std::fs::create_dir_all(&dir.0).map_err(|e| e.to_string())?;

    let has_image = if let Some(b64) = image_jpeg_base64 {
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
        std::fs::write(dir.0.join("foto.jpg"), bytes).map_err(|e| e.to_string())?;
        true
    } else {
        false
    };
    let model = model.filter(|m| !m.trim().is_empty());
    let out_file = dir.0.join("respuesta.txt");

    let mut cmd = command(&bin, &dir.0);
    let stdin_text: String;
    match name {
        "claude" => {
            std::fs::write(dir.0.join("sistema.txt"), &system).map_err(|e| e.to_string())?;
            cmd.args([
                "-p",
                "--output-format",
                "json",
                "--restricted",
                "--tools",
                "Read",
                "--system-prompt-file",
                "sistema.txt",
                "--no-session-persistence",
                "--strict-mcp-config",
                "--disable-slash-commands",
            ]);
            if let Some(m) = &model {
                cmd.args(["--model", m]);
            }
            let note = if has_image { "\n\nLa foto del usuario está en ./foto.jpg: ábrela con la herramienta Read antes de responder." } else { "" };
            stdin_text = format!("{prompt}{note}");
        }
        "codex" => {
            cmd.args(["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-o"]).arg(&out_file);
            if has_image {
                cmd.args(["-i", "foto.jpg"]);
            }
            if let Some(m) = &model {
                cmd.args(["-m", m]);
            }
            cmd.arg("-");
            stdin_text = format!("{system}\n\n---\n\n{prompt}");
        }
        _ => {
            let p = if has_image { "Foto del usuario: @foto.jpg" } else { "Responde según las instrucciones anteriores." };
            cmd.args(["-p", p, "-o", "json", "--approval-mode", "plan"]);
            if let Some(m) = &model {
                cmd.args(["-m", m]);
            }
            stdin_text = format!("{system}\n\n---\n\n{prompt}");
        }
    }

    let mut child = cmd.spawn().map_err(|e| format!("No se pudo iniciar {name}: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(stdin_text.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| format!("{name} tardó más de {} s en responder.", TIMEOUT.as_secs()))?
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let tail = |s: &str| s.trim().chars().rev().take(600).collect::<String>().chars().rev().collect::<String>();

    let text = match name {
        "claude" => {
            let v: serde_json::Value = serde_json::from_str(stdout.trim()).map_err(|_| format!("Claude Code no respondió como se esperaba: {}", tail(&format!("{stdout}\n{stderr}"))))?;
            if v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false) {
                return Err(format!("Claude Code: {}", v.get("result").and_then(|x| x.as_str()).unwrap_or("error desconocido")));
            }
            v.get("result").and_then(|x| x.as_str()).unwrap_or_default().to_string()
        }
        "codex" => std::fs::read_to_string(&out_file).unwrap_or_default(),
        _ => first_json_field(&stdout, &["response"]).unwrap_or_default(),
    };

    if text.trim().is_empty() {
        return Err(format!("{name} no devolvió respuesta (código {:?}). {}", output.status.code(), tail(&format!("{stderr}\n{stdout}"))));
    }
    Ok(text)
}
