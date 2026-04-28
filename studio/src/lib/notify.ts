// OS native notifications via tauri-plugin-notification.
//
// Call sendNotification() for important background events:
//   - Scheduler job completion / error
//   - Gateway message received (when window is not focused)
//   - Critical sidecar errors
//
// Falls back silently when permission is denied or when running in test env.

import { isPermissionGranted, requestPermission, sendNotification as tauriNotify } from "@tauri-apps/plugin-notification";

let _permChecked = false;
let _permGranted = false;

async function ensurePermission(): Promise<boolean> {
  if (_permChecked) return _permGranted;
  _permChecked = true;
  try {
    _permGranted = await isPermissionGranted();
    if (!_permGranted) {
      const perm = await requestPermission();
      _permGranted = perm === "granted";
    }
  } catch {
    _permGranted = false;
  }
  return _permGranted;
}

export interface NotifyOptions {
  title: string;
  body?: string;
  // "info" | "warning" | "error" maps to OS notification urgency where supported
  kind?: "info" | "warning" | "error";
}

export async function notify(opts: NotifyOptions): Promise<void> {
  // Skip in test environment
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
  // Skip if window is focused — in-app toasts are sufficient
  if (document.hasFocus()) return;
  try {
    const granted = await ensurePermission();
    if (!granted) return;
    const notifyPayload = opts.body !== undefined
      ? { title: opts.title, body: opts.body }
      : { title: opts.title };
    await tauriNotify(notifyPayload);
  } catch {
    // Notification sending is best-effort — never throw to callers
  }
}
