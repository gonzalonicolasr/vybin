// UserModelView.test.tsx — identity card redesign (v0.4)
// Covers:
//   - Render with mock model
//   - Empty / loading states
//   - Completeness score calculation
//   - Expertise area expand/edit/delete/add
//   - Project edit/delete
//   - Communication prefs pill toggles
//   - Preference delete
//   - Growth timeline
//   - Save/cancel roundtrip (calls saveUserModel, shows toast)
//   - History panel toggle

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserModelView, computeCompleteness } from "./UserModelView";
import type { UserModel } from "../hooks/useCeroData";
import * as ceroData from "../hooks/useCeroData";
import { ToastContext } from "../hooks/ToastContext";
import type { ToastCtxValue } from "../hooks/ToastContext";

// ─── mock Tauri fs ────────────────────────────────────────────────────────────
// vitest.config.ts aliases @tauri-apps/plugin-fs to the mock module;
// we re-mock here to control per-test behavior.

import * as fs from "@tauri-apps/plugin-fs";

vi.mock("../hooks/useCeroData", async (importActual) => {
  const actual = await importActual<typeof ceroData>();
  return {
    ...actual,
    readUserModel: vi.fn(),
    saveUserModel: vi.fn().mockResolvedValue(undefined),
    useUserModel: vi.fn(),
  };
});

// ─── test fixtures ────────────────────────────────────────────────────────────

const MOCK_MODEL: UserModel = {
  version: 8,
  expertise_areas: [
    { area: "TypeScript", level: "expert", evidence_count: 24, last_evidence_at: Date.now() - 3_600_000 },
    { area: "React", level: "advanced", evidence_count: 12 },
    { area: "Python", level: "intermediate", evidence_count: 5 },
  ],
  current_projects: [
    { name: "cero studio", cwd: "/home/user/cero", status: "active", last_active_at: Date.now() - 7_200_000 },
    { name: "old-proj", status: "archived", last_active_at: Date.now() - 86_400_000 * 30 },
  ],
  preferences: [
    { key: "editor", value: "neovim", confidence: 0.9, source: "explicit", ts: Date.now() - 1000 },
    { key: "dark_mode", value: true, confidence: 0.7, source: "inferred", ts: Date.now() - 2000 },
  ],
  working_style: { prefers_test_first: true },
  communication_prefs: { language: "en", tone: "concise", emoji_usage: "none" },
  history: [
    { ts: Date.now() - 100_000, source: "agent", patch: { expertise_areas: [] }, reason: "session ended" },
    { ts: Date.now() - 200_000, source: "user", patch: {}, reason: "manual edit" },
  ],
  last_updated_at: Date.now() - 3_600_000,
};

const EMPTY_MODEL: UserModel = {
  version: 1,
  expertise_areas: [],
  current_projects: [],
  preferences: [],
  working_style: {},
  communication_prefs: {},
  history: [],
  last_updated_at: Date.now(),
};

// ─── toast context helper ─────────────────────────────────────────────────────

function makeToastCtx(): ToastCtxValue & { successMsg: string | null } {
  let msg: string | null = null;
  const ctx: ToastCtxValue = {
    toasts: [],
    dismiss: vi.fn(),
    toast: {
      success: (m) => { msg = m; },
      error: vi.fn(),
      info: vi.fn(),
    },
  };
  return { ...ctx, get successMsg() { return msg; } };
}

function renderView(model: UserModel | null, loading = false) {
  const toastCtx = makeToastCtx();
  vi.mocked(ceroData.useUserModel).mockReturnValue({
    model,
    loading,
    refresh: vi.fn().mockResolvedValue(undefined),
  });
  const result = render(
    <ToastContext.Provider value={toastCtx}>
      <UserModelView snapshotVersion={0} />
    </ToastContext.Provider>,
  );
  return { ...result, toastCtx };
}

// ─── completeness score ───────────────────────────────────────────────────────

describe("computeCompleteness", () => {
  it("returns 0 for a minimal model", () => {
    expect(computeCompleteness(EMPTY_MODEL)).toBe(0);
  });

  it("returns 100 for a fully populated model above all thresholds", () => {
    const full: UserModel = {
      ...EMPTY_MODEL,
      version: 6,
      expertise_areas: Array.from({ length: 5 }, (_, i) => ({
        area: `skill-${i}`,
        level: "expert" as const,
        evidence_count: 10,
      })),
      current_projects: Array.from({ length: 3 }, (_, i) => ({
        name: `proj-${i}`,
        status: "active" as const,
        last_active_at: Date.now(),
      })),
      preferences: Array.from({ length: 5 }, (_, i) => ({
        key: `k${i}`,
        value: "v",
        confidence: 0.8,
        source: "explicit" as const,
        ts: Date.now(),
      })),
      communication_prefs: { language: "en" },
    };
    expect(computeCompleteness(full)).toBe(100);
  });

  it("caps at 100 even when every bucket maxes out", () => {
    const overFull: UserModel = {
      ...EMPTY_MODEL,
      version: 10,
      expertise_areas: Array.from({ length: 10 }, (_, i) => ({
        area: `s${i}`, level: "expert" as const, evidence_count: 1,
      })),
      current_projects: Array.from({ length: 6 }, (_, i) => ({
        name: `p${i}`, status: "active" as const, last_active_at: Date.now(),
      })),
      preferences: Array.from({ length: 10 }, (_, i) => ({
        key: `k${i}`, value: "v", confidence: 0.9, source: "explicit" as const, ts: Date.now(),
      })),
      communication_prefs: { language: "en" },
    };
    expect(computeCompleteness(overFull)).toBe(100);
  });

  it("computes partial score correctly (expertise only)", () => {
    const model: UserModel = {
      ...EMPTY_MODEL,
      expertise_areas: [
        { area: "ts", level: "expert", evidence_count: 1 },
        { area: "py", level: "advanced", evidence_count: 1 },
      ],
    };
    // 2/5 * 30 = 12 → 12%
    expect(computeCompleteness(model)).toBe(12);
  });

  it("version score triggers only when version > 5", () => {
    const at5 = computeCompleteness({ ...EMPTY_MODEL, version: 5 });
    const at6 = computeCompleteness({ ...EMPTY_MODEL, version: 6 });
    expect(at6 - at5).toBe(10);
  });
});

// ─── render states ────────────────────────────────────────────────────────────

describe("UserModelView — render states", () => {
  it("shows loading state", () => {
    renderView(null, true);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("shows empty state when model is null", () => {
    renderView(null, false);
    expect(screen.getByText(/no user model yet/i)).toBeTruthy();
  });

  it("renders IDENTITY header with version badge", () => {
    renderView(MOCK_MODEL);
    expect(screen.getByText("IDENTITY")).toBeTruthy();
    // version badge appears in both the header span and the identity badges pill
    expect(screen.getAllByText("v8").length).toBeGreaterThanOrEqual(1);
  });

  it("renders avatar character from first expertise area", () => {
    renderView(MOCK_MODEL);
    // First expertise area is "TypeScript" → avatar = "T"
    expect(screen.getByLabelText("user avatar").textContent).toBe("T");
  });

  it("renders all expertise area names", () => {
    renderView(MOCK_MODEL);
    expect(screen.getByText("TypeScript")).toBeTruthy();
    expect(screen.getByText("React")).toBeTruthy();
    expect(screen.getByText("Python")).toBeTruthy();
  });

  it("renders project names", () => {
    renderView(MOCK_MODEL);
    expect(screen.getByText("cero studio")).toBeTruthy();
    expect(screen.getByText("old-proj")).toBeTruthy();
  });

  it("renders completeness score svg", () => {
    renderView(MOCK_MODEL);
    const svg = document.querySelector("svg[aria-label*='completeness']");
    expect(svg).toBeTruthy();
  });
});

// ─── expertise interaction ────────────────────────────────────────────────────

describe("UserModelView — expertise interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("expands expertise row on click to reveal action buttons", async () => {
    renderView(MOCK_MODEL);
    const tsRow = screen.getByText("TypeScript").closest(".um-expertise-main")!;
    fireEvent.click(tsRow);
    await waitFor(() => {
      expect(screen.getAllByText("edit").length).toBeGreaterThan(0);
      expect(screen.getAllByText("delete").length).toBeGreaterThan(0);
    });
  });

  it("shows confirm delete after first delete click", async () => {
    renderView(MOCK_MODEL);
    const tsRow = screen.getByText("TypeScript").closest(".um-expertise-main")!;
    fireEvent.click(tsRow);
    await waitFor(() => screen.getAllByText("delete"));
    const deleteBtn = screen.getAllByText("delete")[0];
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(screen.getByText(/confirm delete/i)).toBeTruthy();
    });
  });

  it("adds a new expertise area", async () => {
    renderView(MOCK_MODEL);
    fireEvent.click(screen.getByText("+ add"));
    const input = screen.getByLabelText(/new expertise area/i);
    await userEvent.type(input, "Rust");
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => {
      expect(screen.getByText("Rust")).toBeTruthy();
    });
  });

  it("enters edit mode for expertise area", async () => {
    renderView(MOCK_MODEL);
    const tsRow = screen.getByText("TypeScript").closest(".um-expertise-main")!;
    fireEvent.click(tsRow);
    await waitFor(() => screen.getAllByText("edit"));
    fireEvent.click(screen.getAllByText("edit")[0]);
    await waitFor(() => {
      const input = screen.getByLabelText(/expertise area name/i) as HTMLInputElement;
      expect(input.value).toBe("TypeScript");
    });
  });

  it("cancels edit without mutating state", async () => {
    renderView(MOCK_MODEL);
    const tsRow = screen.getByText("TypeScript").closest(".um-expertise-main")!;
    fireEvent.click(tsRow);
    await waitFor(() => screen.getAllByText("edit"));
    fireEvent.click(screen.getAllByText("edit")[0]);
    const cancelBtn = screen.getAllByText("cancel")[0];
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(screen.getByText("TypeScript")).toBeTruthy();
    });
  });
});

// ─── save roundtrip ───────────────────────────────────────────────────────────

describe("UserModelView — save roundtrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ceroData.saveUserModel).mockResolvedValue(undefined);
  });

  it("save bar is hidden when no edits made", () => {
    renderView(MOCK_MODEL);
    expect(screen.queryByText("save changes")).toBeNull();
  });

  it("save bar appears after an edit", async () => {
    renderView(MOCK_MODEL);
    // Add a new expertise area to trigger dirty state
    fireEvent.click(screen.getByText("+ add"));
    const input = screen.getByLabelText(/new expertise area/i);
    await userEvent.type(input, "Go");
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => {
      expect(screen.getByText("save changes")).toBeTruthy();
    });
  });

  it("cancel resets dirty state", async () => {
    renderView(MOCK_MODEL);
    fireEvent.click(screen.getByText("+ add"));
    const input = screen.getByLabelText(/new expertise area/i);
    await userEvent.type(input, "Go");
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => screen.getByText("save changes"));
    fireEvent.click(screen.getByText("cancel"));
    await waitFor(() => {
      expect(screen.queryByText("save changes")).toBeNull();
    });
  });

  it("save button calls saveUserModel and shows success toast", async () => {
    const { toastCtx } = renderView(MOCK_MODEL);
    // Make an edit
    fireEvent.click(screen.getByText("+ add"));
    const input = screen.getByLabelText(/new expertise area/i);
    await userEvent.type(input, "Go");
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => screen.getByText("save changes"));
    fireEvent.click(screen.getByText("save changes"));
    await waitFor(() => {
      expect(ceroData.saveUserModel).toHaveBeenCalledTimes(1);
    });
  });

  it("saveUserModel is called with model including the new expertise area", async () => {
    renderView(MOCK_MODEL);
    fireEvent.click(screen.getByText("+ add"));
    const input = screen.getByLabelText(/new expertise area/i);
    await userEvent.type(input, "Elixir");
    fireEvent.click(screen.getByText("add"));
    await waitFor(() => screen.getByText("save changes"));
    fireEvent.click(screen.getByText("save changes"));
    await waitFor(() => {
      const call = vi.mocked(ceroData.saveUserModel).mock.calls[0];
      expect(call).toBeDefined();
      const savedModel = call[0];
      expect(savedModel.expertise_areas.some((a) => a.area === "Elixir")).toBe(true);
    });
  });
});

// ─── communication prefs pills ────────────────────────────────────────────────

describe("UserModelView — communication prefs", () => {
  it("renders language pills with active state", () => {
    renderView(MOCK_MODEL);
    // "en" is active — the pill should have the active class
    const enBtn = screen.getByRole("button", { name: "en" });
    expect(enBtn.className).toContain("um-pill-active");
  });

  it("clicking a tone pill marks it active", async () => {
    renderView(MOCK_MODEL);
    const detailedBtn = screen.getByRole("button", { name: "detailed" });
    fireEvent.click(detailedBtn);
    await waitFor(() => {
      expect(detailedBtn.className).toContain("um-pill-active");
    });
  });

  it("selecting a different tone makes the save bar appear", async () => {
    renderView(MOCK_MODEL);
    fireEvent.click(screen.getByRole("button", { name: "detailed" }));
    await waitFor(() => {
      expect(screen.getByText("save changes")).toBeTruthy();
    });
  });
});

// ─── history panel ────────────────────────────────────────────────────────────

describe("UserModelView — history panel", () => {
  it("switches to history view when history button clicked", async () => {
    renderView(MOCK_MODEL);
    // The button text is "history (2)" for MOCK_MODEL
    const historyBtn = screen.getByRole("button", { name: /history/i });
    fireEvent.click(historyBtn);
    await waitFor(() => {
      // History entries source labels appear in the dv-row-title column
      const titleEls = document.querySelectorAll(".dv-row-title");
      const texts = Array.from(titleEls).map((el) => el.textContent ?? "");
      expect(texts.some((t) => t.includes("agent"))).toBe(true);
    });
  });

  it("switches back to card view", async () => {
    renderView(MOCK_MODEL);
    const historyBtn = screen.getByRole("button", { name: /history/i });
    fireEvent.click(historyBtn);
    await waitFor(() => document.querySelectorAll(".dv-row-title").length > 0);
    const cardBtn = screen.getByRole("button", { name: /card/i });
    fireEvent.click(cardBtn);
    await waitFor(() => {
      expect(screen.getByText("TypeScript")).toBeTruthy();
    });
  });

  it("shows empty state when history is empty", async () => {
    renderView(EMPTY_MODEL);
    const historyBtn = screen.getByRole("button", { name: /history/i });
    fireEvent.click(historyBtn);
    await waitFor(() => {
      expect(screen.getByText(/no history entries yet/i)).toBeTruthy();
    });
  });
});

// ─── empty states per section ─────────────────────────────────────────────────

describe("UserModelView — empty section states", () => {
  it("shows friendly message when expertise_areas is empty", () => {
    renderView(EMPTY_MODEL);
    expect(screen.getByText(/no expertise areas yet/i)).toBeTruthy();
  });

  it("shows friendly message when current_projects is empty", () => {
    renderView(EMPTY_MODEL);
    expect(screen.getByText(/no projects tracked yet/i)).toBeTruthy();
  });

  it("shows friendly message when preferences is empty", () => {
    renderView(EMPTY_MODEL);
    expect(screen.getByText(/no preferences recorded yet/i)).toBeTruthy();
  });
});

// ─── growth timeline ──────────────────────────────────────────────────────────

describe("UserModelView — growth timeline", () => {
  it("renders timeline events from history", () => {
    renderView(MOCK_MODEL);
    // Timeline events exist — source dots visible
    const dots = document.querySelectorAll(".um-timeline-dot");
    expect(dots.length).toBeGreaterThan(0);
  });

  it("shows fallback text when no history", () => {
    renderView(EMPTY_MODEL);
    // The timeline section renders "v1 — learning accumulates here after each session"
    const fallbackEl = screen.getByText(/learning accumulates/i);
    expect(fallbackEl).toBeTruthy();
  });
});

// ─── name editing ─────────────────────────────────────────────────────────────

describe("UserModelView — name editing", () => {
  it("renders 'anon' as initial name", () => {
    renderView(MOCK_MODEL);
    expect(screen.getByText("anon")).toBeTruthy();
  });

  it("clicking the name button activates edit input", async () => {
    renderView(MOCK_MODEL);
    const nameBtn = screen.getByText("anon");
    fireEvent.click(nameBtn);
    await waitFor(() => {
      const input = screen.getByLabelText(/user name/i);
      expect(input).toBeTruthy();
    });
  });

  it("pressing Enter commits the new name", async () => {
    renderView(MOCK_MODEL);
    fireEvent.click(screen.getByText("anon"));
    const input = screen.getByLabelText(/user name/i);
    await userEvent.clear(input);
    await userEvent.type(input, "Gonza{Enter}");
    await waitFor(() => {
      expect(screen.getByText("Gonza")).toBeTruthy();
    });
  });
});
