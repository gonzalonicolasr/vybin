// IPC message types for clarify/approval request-response cycle.
// Mirrors the protocol defined in cero/src/cli/chat-ipc.ts.

// ─── Inbound (sidecar → studio) ─────────────────────────────────────────────

export interface ClarifyRequest {
  readonly type: "clarify-request";
  readonly tab_id: string;
  readonly id: number;
  readonly question: string;
  readonly choices?: string[];
  readonly allowFree?: boolean;
}

export type DangerLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRequest {
  readonly type: "approval-request";
  readonly tab_id: string;
  readonly id: number;
  readonly command: string;
  readonly description?: string;
  readonly dangerLevel: DangerLevel;
  readonly category: string;
}

// ─── Outbound (studio → sidecar) ────────────────────────────────────────────

export interface ClarifyResponse {
  readonly type: "clarify-response";
  readonly id: number;
  readonly answer: string | null;
  readonly choiceIndex?: number;
  readonly reason?: string;
}

export interface ApprovalResponse {
  readonly type: "approval-response";
  readonly id: number;
  readonly approved: boolean;
  readonly rememberForSession?: boolean;
  readonly reason?: string;
}

// ─── Queue entry (per-tab FIFO) ──────────────────────────────────────────────

export type PendingRequest =
  | { kind: "clarify"; req: ClarifyRequest }
  | { kind: "approval"; req: ApprovalRequest };
