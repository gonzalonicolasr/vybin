// Vybin — Tauri desktop shell (internal crate name `cero_studio_lib` kept).
//
// This is the absolute minimum entry point. The real work (sidecar to the
// `cero` binary, IPC bridging AgentEvents to the React UI, file watchers on
// ~/.cero/{skills,lessons,user-model.json}) lives in lib.rs and is wired
// via Tauri commands and events. The main.rs is intentionally tiny so that
// `tauri dev` and `tauri build` see a stable entrypoint regardless of how
// big the lib gets.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cero_studio_lib::run();
}
