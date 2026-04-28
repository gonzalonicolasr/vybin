// Cero sidecar — spawns the cero binary in --ipc-mode jsonl, pipes
// stdin/stdout, and bridges JSON-line messages to Tauri events / commands.
//
// Multi-tab architecture: each tab owns a separate child process.
// HashMap<tab_id, SidecarHandle> keyed by UUID v4 string (assigned by the
// frontend). All commands accept a tab_id so the backend routes to the right
// process. Events carry tab_id so the frontend can route incoming messages to
// the correct tab's history.
//
// Design decisions:
//   - Max 10 concurrent tabs (pragmatic, ~100 MB each). open_tab returns Err
//     if exceeded.
//   - If the last tab closes, frontend spawns a new one automatically.
//   - Settings (API keys, provider) are global — all tabs share the same env.
//   - tab_id is studio-owned. cero binary receives it only as context in the
//     event payload, it does not persist cross-process.

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;

/// Channel name for outbound JSON messages from cero → frontend.
/// Each payload JSON object includes a "tab_id" field so the React
/// dispatcher can route it to the right tab.
pub const EVENT_CHANNEL: &str = "cero-event";

/// Maximum concurrent tabs. Kept as a constant so it's easy to adjust.
const MAX_TABS: usize = 10;

// ─────────────── state ───────────────

struct SidecarHandle {
    child: Child,
    stdin: ChildStdin,
}

/// Global state: one map per studio process, wrapped in a single Mutex.
/// The Mutex serialises stdin writes from concurrent invoke calls.
pub struct SidecarState {
    inner: Mutex<HashMap<String, SidecarHandle>>,
}

static STATE: OnceCell<SidecarState> = OnceCell::new();

pub fn init_state() -> &'static SidecarState {
    STATE.get_or_init(|| SidecarState {
        inner: Mutex::new(HashMap::new()),
    })
}

// ─────────────── config types ───────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StartSessionConfig {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub sandbox: Option<String>,
    pub goal: Option<String>,
    pub no_learning: Option<bool>,
}

// ─────────────── binary location ───────────────

/// Locate the cero binary on disk and the working directory it should run in.
///
/// Priority (first match wins):
///   1. CERO_BIN env var
///   2. Bundled sidecar — same dir as studio exe
///   3. Dev hardcode (debug builds only) — set via CERO_BIN or place alongside exe
///   4. PATH lookup
fn locate_cero(_app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let exe_name = if cfg!(windows) { "cero.exe" } else { "cero" };

    if let Ok(p) = std::env::var("CERO_BIN") {
        let bin = PathBuf::from(&p);
        if bin.is_file() {
            let cwd = bin
                .parent()
                .and_then(|d| d.parent())
                .map(|d| d.to_path_buf())
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
            return Ok((bin, cwd));
        }
        return Err(format!("CERO_BIN set but file does not exist: {}", p));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(exe_name);
            if bundled.is_file() {
                let cwd = dirs_home().unwrap_or_else(|| dir.to_path_buf());
                return Ok((bundled, cwd));
            }
        }
    }

    // Dev-only fallback: hardcoded developer machine path.
    // Excluded from release builds via debug_assertions to prevent username
    // leakage and avoid executing arbitrary binaries on end-user machines.
    #[cfg(all(windows, debug_assertions))]
    {
        let dev = PathBuf::from(r"C:\Users\gonza\cero\dist\cero-windows.exe");
        if dev.is_file() {
            let cwd = PathBuf::from(r"C:\Users\gonza\cero");
            return Ok((dev, cwd));
        }
    }

    if let Ok(paths) = std::env::var("PATH") {
        for p in std::env::split_paths(&paths) {
            let candidate = p.join(exe_name);
            if candidate.is_file() {
                let cwd = dirs_home().unwrap_or_else(|| std::env::current_dir().unwrap_or(p));
                return Ok((candidate, cwd));
            }
        }
    }

    Err("cero binary not found. Tried: $CERO_BIN, bundled-sidecar, dev path, $PATH".to_string())
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Ok(p) = std::env::var("USERPROFILE") {
            let pb = PathBuf::from(p);
            if pb.is_dir() {
                return Some(pb);
            }
        }
    }
    if let Ok(p) = std::env::var("HOME") {
        let pb = PathBuf::from(p);
        if pb.is_dir() {
            return Some(pb);
        }
    }
    None
}

// ─────────────── spawn helper ───────────────

/// Spawn a new cero child process for the given tab_id and register readers
/// that forward stdout/stderr lines to the frontend as Tauri events.
/// Each emitted JSON object is augmented with `"tab_id"` before forwarding.
async fn spawn_tab(
    app: AppHandle,
    tab_id: String,
    config: &StartSessionConfig,
    env: &HashMap<String, String>,
) -> Result<SidecarHandle, String> {
    let (bin, cwd) = locate_cero(&app)?;

    let mut cmd = tokio::process::Command::new(&bin);
    cmd.current_dir(&cwd);
    cmd.arg("chat").arg("--ipc-mode").arg("jsonl");
    if let Some(p) = &config.provider {
        cmd.arg("--provider").arg(p);
    }
    if let Some(m) = &config.model {
        cmd.arg("--model").arg(m);
    }
    if let Some(b) = &config.base_url {
        if !b.is_empty() {
            cmd.arg("--base-url").arg(b);
        }
    }
    if let Some(s) = &config.sandbox {
        cmd.arg("--sandbox").arg(s);
    }
    if let Some(g) = &config.goal {
        if !g.is_empty() {
            cmd.arg("--goal").arg(g);
        }
    }
    if config.no_learning.unwrap_or(false) {
        cmd.arg("--no-learning");
    }
    for (k, v) in env {
        if !v.is_empty() {
            cmd.env(k, v);
        }
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000 — hides the console flash
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn cero ({}): {}", bin.display(), e))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "stdin pipe unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "stdout pipe unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "stderr pipe unavailable".to_string())?;

    // stdout reader: inject tab_id into each JSON line before emitting
    let app_out = app.clone();
    let tid_out = tab_id.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    let tagged = inject_tab_id(&line, &tid_out);
                    let _ = app_out.emit(EVENT_CHANNEL, tagged);
                }
                Ok(None) => break,
                Err(e) => {
                    let tagged = format!(
                        "{{\"type\":\"error\",\"tab_id\":\"{}\",\"message\":\"sidecar stdout read error: {}\"}}",
                        tid_out, e
                    );
                    let _ = app_out.emit(EVENT_CHANNEL, tagged);
                    break;
                }
            }
        }
        // EOF = sidecar exited
        let exit_msg = format!(
            "{{\"type\":\"sidecar-exit\",\"tab_id\":\"{}\"}}",
            tid_out
        );
        let _ = app_out.emit(EVENT_CHANNEL, exit_msg);
    });

    // stderr reader
    let app_err = app.clone();
    let tid_err = tab_id.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let payload = serde_json::json!({
                "type": "sidecar-stderr",
                "tab_id": tid_err,
                "line": line,
            });
            let _ = app_err.emit(EVENT_CHANNEL, payload.to_string());
        }
    });

    Ok(SidecarHandle { child, stdin })
}

/// Inject `"tab_id": "<id>"` into a JSON object string.
/// Strategy: parse as Value, insert key, re-serialize. Falls back to a
/// manually-crafted envelope if the line isn't valid JSON.
fn inject_tab_id(line: &str, tab_id: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(mut v) => {
            if let Some(obj) = v.as_object_mut() {
                obj.insert(
                    "tab_id".to_string(),
                    serde_json::Value::String(tab_id.to_string()),
                );
            }
            serde_json::to_string(&v).unwrap_or_else(|_| line.to_string())
        }
        Err(_) => {
            // Not JSON — wrap it so the frontend still sees a parseable message
            format!(
                "{{\"type\":\"sidecar-stderr\",\"tab_id\":\"{}\",\"line\":{}}}",
                tab_id,
                serde_json::to_string(line).unwrap_or_else(|_| "\"<unparseable>\"".to_string())
            )
        }
    }
}

/// Gracefully shut down a SidecarHandle (send shutdown, wait 30s, kill if needed).
async fn shutdown_handle(mut h: SidecarHandle) {
    let payload = serde_json::json!({ "type": "shutdown" });
    let line = format!("{}\n", payload);
    let _ = h.stdin.write_all(line.as_bytes()).await;
    let _ = h.stdin.flush().await;
    drop(h.stdin);
    let kill = tokio::time::timeout(
        tokio::time::Duration::from_secs(30),
        h.child.wait(),
    )
    .await;
    if kill.is_err() {
        let _ = h.child.kill().await;
    }
}

// ─────────────── stdin write helper ───────────────

/// Write a JSON-serialisable payload to the stdin of the tab identified by
/// `tab_id`. Returns Err if the tab does not exist.
async fn write_to_tab(
    guard: &mut HashMap<String, SidecarHandle>,
    tab_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let handle = guard
        .get_mut(tab_id)
        .ok_or_else(|| format!("no session for tab_id={tab_id}"))?;
    let line = format!("{}\n", payload);
    handle
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("stdin write failed: {e}"))?;
    handle
        .stdin
        .flush()
        .await
        .map_err(|e| format!("stdin flush failed: {e}"))
}

// ─────────────── Tauri commands — tab lifecycle ───────────────

/// Open a new tab: spawn a new cero process for the given tab_id.
/// Idempotent: if the tab_id already has a live sidecar, this is a no-op
/// (frontend effects can fire repeatedly during hot-reload / settings changes,
/// and there's no need to error out — the existing sidecar keeps serving).
/// Returns Err only when MAX_TABS is reached.
#[tauri::command]
pub async fn open_tab(
    app: AppHandle,
    state: tauri::State<'_, &'static SidecarState>,
    tab_id: String,
    config: StartSessionConfig,
    env: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if guard.contains_key(&tab_id) {
        // Already running — silently succeed (idempotent re-init).
        return Ok(());
    }
    if guard.len() >= MAX_TABS {
        return Err(format!(
            "max {MAX_TABS} concurrent tabs reached — close one before opening another"
        ));
    }
    let handle = spawn_tab(app, tab_id.clone(), &config, &env).await?;
    guard.insert(tab_id, handle);
    Ok(())
}

/// Close a tab: gracefully shut down the cero process and remove from map.
#[tauri::command]
pub async fn close_tab(
    state: tauri::State<'_, &'static SidecarState>,
    tab_id: String,
) -> Result<(), String> {
    let handle = state.inner.lock().await.remove(&tab_id);
    if let Some(h) = handle {
        // Run shutdown in background — don't block the UI thread 30s.
        tokio::spawn(shutdown_handle(h));
    }
    Ok(())
}

/// List currently active tab IDs.
#[tauri::command]
pub async fn list_tabs(
    state: tauri::State<'_, &'static SidecarState>,
) -> Result<Vec<String>, String> {
    let guard = state.inner.lock().await;
    Ok(guard.keys().cloned().collect())
}

// ─────────────── Tauri commands — per-tab IPC ───────────────

#[tauri::command]
pub async fn send_prompt(
    state: tauri::State<'_, &'static SidecarState>,
    tab_id: String,
    text: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    write_to_tab(&mut guard, &tab_id, serde_json::json!({ "type": "prompt", "text": text })).await
}

#[tauri::command]
pub async fn send_slash(
    state: tauri::State<'_, &'static SidecarState>,
    tab_id: String,
    raw: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    write_to_tab(&mut guard, &tab_id, serde_json::json!({ "type": "slash", "raw": raw })).await
}

#[tauri::command]
pub async fn cancel_turn(
    state: tauri::State<'_, &'static SidecarState>,
    tab_id: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    write_to_tab(&mut guard, &tab_id, serde_json::json!({ "type": "cancel" })).await
}

#[tauri::command]
pub async fn request_snapshot(
    state: tauri::State<'_, &'static SidecarState>,
    tab_id: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    write_to_tab(&mut guard, &tab_id, serde_json::json!({ "type": "snapshot-request" })).await
}

// ─────────────── legacy / global commands ───────────────

/// Restart ALL tabs with new settings (called when user saves Settings).
/// Closes every tab, then opens a fresh one for each tab_id passed in.
/// The frontend passes the current tab_ids so the same logical tabs are
/// preserved (history is in React state, not in cero, so it survives).
#[tauri::command]
pub async fn restart_session(
    app: AppHandle,
    state: tauri::State<'_, &'static SidecarState>,
    config: StartSessionConfig,
    env: std::collections::HashMap<String, String>,
    tab_ids: Vec<String>,
) -> Result<(), String> {
    // Drain all current handles
    let old: Vec<SidecarHandle> = {
        let mut guard = state.inner.lock().await;
        guard.drain().map(|(_, v)| v).collect()
    };
    // Shutdown in background (don't block)
    for h in old {
        tokio::spawn(shutdown_handle(h));
    }
    // Re-spawn for each tab_id
    let mut errors: Vec<String> = Vec::new();
    for tab_id in &tab_ids {
        match spawn_tab(app.clone(), tab_id.clone(), &config, &env).await {
            Ok(handle) => {
                state.inner.lock().await.insert(tab_id.clone(), handle);
            }
            Err(e) => errors.push(format!("{tab_id}: {e}")),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Send a raw JSON payload to a specific tab's sidecar stdin.
/// Used for clarify-response and approval-response IPC messages.
/// The payload must be a valid JSON object; it is written verbatim + "\n".
#[tauri::command]
pub async fn respond_request(
    state: tauri::State<'_, &'static SidecarState>,
    tab_id: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    // Validate it's an object and has a "type" field starting with an expected prefix
    let t = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if t != "clarify-response" && t != "approval-response" {
        return Err(format!("respond_request: unexpected type '{t}' (expected clarify-response or approval-response)"));
    }
    let mut guard = state.inner.lock().await;
    write_to_tab(&mut guard, &tab_id, payload).await
}

/// Shut down every sidecar. Called on app exit.
#[tauri::command]
pub async fn shutdown_session(
    state: tauri::State<'_, &'static SidecarState>,
) -> Result<(), String> {
    let old: Vec<SidecarHandle> = {
        let mut guard = state.inner.lock().await;
        guard.drain().map(|(_, v)| v).collect()
    };
    for h in old {
        tokio::spawn(shutdown_handle(h));
    }
    Ok(())
}

// ─────────────── env import ───────────────

/// Look for a `.env` in well-known cero locations and return parsed KV pairs.
/// Used by the studio first-launch flow to seed Settings.
#[tauri::command]
pub async fn try_import_env() -> Result<std::collections::HashMap<String, String>, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("CERO_PROJECT") {
        candidates.push(PathBuf::from(p).join(".env"));
    }
    // Dev-only fallback: excluded from release builds (see debug_assertions note above).
    #[cfg(all(windows, debug_assertions))]
    candidates.push(PathBuf::from(r"C:\Users\gonza\cero\.env"));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(".env"));
        }
    }
    if let Some(home) = dirs_home() {
        candidates.push(home.join("cero").join(".env"));
        candidates.push(home.join(".cero").join(".env"));
    }

    for path in candidates {
        if !path.is_file() {
            continue;
        }
        let txt = match tokio::fs::read_to_string(&path).await {
            Ok(t) => t,
            Err(_) => continue,
        };
        let parsed = parse_dotenv(&txt);
        if !parsed.is_empty() {
            return Ok(parsed);
        }
    }
    Ok(std::collections::HashMap::new())
}

fn parse_dotenv(txt: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for raw in txt.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(eq) = line.find('=') else { continue };
        let key = line[..eq].trim().to_string();
        let mut val = line[eq + 1..].trim().to_string();
        if (val.starts_with('"') && val.ends_with('"'))
            || (val.starts_with('\'') && val.ends_with('\''))
        {
            val = val[1..val.len() - 1].to_string();
        }
        if !key.is_empty() {
            out.insert(key, val);
        }
    }
    out
}

// ─────────────── legacy single-tab shims (kept for old callers during transition) ───────────────
// These are intentionally NOT re-exported. All new code uses tab_id variants.
// Keeping start_session as dead code removed — it's been superseded by open_tab.
