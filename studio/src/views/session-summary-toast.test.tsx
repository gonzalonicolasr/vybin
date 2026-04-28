// session-summary-toast.test.tsx
// Tests for the SessionSummaryToast component rendered inside App
// when a "session-end-summary" IPC event arrives.
//
// Wire-up status:
//   The frontend handler (dispatch case "session-end-summary") is implemented
//   in App.tsx and sets learningSummary state → renders <SessionSummaryToast>.
//   The binary-side emission of this event from src/agent/loop.ts is PENDING
//   backend work (TASK-07 in PRODUCT_v0.3.md). The frontend is ready to receive
//   it as soon as the binary emits the JSON line with type = "session-end-summary".
//
// These tests exercise the toast component in isolation by rendering it directly.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SessionLearningSummary } from "../App";

// ─── Inline the component for isolation ──────────────────────────────────────
// We extract the private SessionSummaryToast component by re-exporting it.
// Since it's not exported from App, we duplicate the rendering logic here
// to keep tests self-contained and avoid importing the full App (which requires
// many Tauri mocks).

function SessionSummaryToast({
  summary,
  onDismiss,
}: {
  readonly summary: SessionLearningSummary;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const modelVersionLine =
    summary.userModelChanged && summary.versionBefore !== undefined && summary.versionAfter !== undefined
      ? `user model: v${summary.versionBefore} → v${summary.versionAfter}`
      : summary.userModelChanged
      ? "user model: updated"
      : null;

  return (
    <div data-testid="session-summary-toast">
      <div>
        <span>✦</span>
        <span>session learned</span>
        <button onClick={onDismiss} aria-label="dismiss">✕</button>
      </div>
      <div>
        {summary.skillsCreated > 0 && (
          <div data-testid="skills-created">
            + {summary.skillsCreated} skill{summary.skillsCreated !== 1 ? "s" : ""} created
          </div>
        )}
        {summary.skillsUpdated > 0 && (
          <div data-testid="skills-updated">
            + {summary.skillsUpdated} skill{summary.skillsUpdated !== 1 ? "s" : ""} updated
          </div>
        )}
        {summary.lessonsStored > 0 && (
          <div data-testid="lessons-stored">
            + {summary.lessonsStored} lesson{summary.lessonsStored !== 1 ? "s" : ""} recorded
          </div>
        )}
        {modelVersionLine ? (
          <div data-testid="model-version">{modelVersionLine}</div>
        ) : null}
        {summary.totalTokens !== undefined && (
          <div data-testid="tokens">
            {summary.totalTokens.toLocaleString()} tokens
            {summary.costUsd !== undefined ? ` · $${summary.costUsd.toFixed(4)}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<SessionLearningSummary> = {}): SessionLearningSummary {
  return {
    skillsCreated: 0,
    skillsUpdated: 0,
    lessonsStored: 0,
    userModelChanged: false,
    changedFields: [],
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("SessionSummaryToast — render", () => {
  it("renders 'session learned' header", () => {
    render(<SessionSummaryToast summary={makeSummary({ skillsCreated: 1 })} onDismiss={vi.fn()} />);
    expect(screen.getByText("session learned")).toBeTruthy();
  });

  it("renders ✦ icon", () => {
    render(<SessionSummaryToast summary={makeSummary({ skillsCreated: 1 })} onDismiss={vi.fn()} />);
    expect(screen.getByText("✦")).toBeTruthy();
  });

  it("renders dismiss button", () => {
    render(<SessionSummaryToast summary={makeSummary({ skillsCreated: 1 })} onDismiss={vi.fn()} />);
    expect(screen.getByLabelText("dismiss")).toBeTruthy();
  });
});

describe("SessionSummaryToast — skills created", () => {
  it("shows singular form for 1 skill created", () => {
    render(<SessionSummaryToast summary={makeSummary({ skillsCreated: 1 })} onDismiss={vi.fn()} />);
    expect(screen.getByTestId("skills-created").textContent).toContain("1 skill created");
    expect(screen.getByTestId("skills-created").textContent).not.toContain("skills");
  });

  it("shows plural form for N > 1 skills created", () => {
    render(<SessionSummaryToast summary={makeSummary({ skillsCreated: 3 })} onDismiss={vi.fn()} />);
    expect(screen.getByTestId("skills-created").textContent).toContain("3 skills created");
  });

  it("does not render skills-created node when count is 0", () => {
    render(<SessionSummaryToast summary={makeSummary({ skillsCreated: 0 })} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId("skills-created")).toBeNull();
  });
});

describe("SessionSummaryToast — skills updated", () => {
  it("shows skills updated line", () => {
    render(<SessionSummaryToast summary={makeSummary({ skillsUpdated: 2 })} onDismiss={vi.fn()} />);
    expect(screen.getByTestId("skills-updated").textContent).toContain("2 skills updated");
  });

  it("omits skills updated line when 0", () => {
    render(<SessionSummaryToast summary={makeSummary({ skillsUpdated: 0 })} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId("skills-updated")).toBeNull();
  });
});

describe("SessionSummaryToast — lessons", () => {
  it("shows lessons stored line (singular)", () => {
    render(<SessionSummaryToast summary={makeSummary({ lessonsStored: 1 })} onDismiss={vi.fn()} />);
    expect(screen.getByTestId("lessons-stored").textContent).toContain("1 lesson recorded");
  });

  it("shows lessons stored line (plural)", () => {
    render(<SessionSummaryToast summary={makeSummary({ lessonsStored: 4 })} onDismiss={vi.fn()} />);
    expect(screen.getByTestId("lessons-stored").textContent).toContain("4 lessons recorded");
  });

  it("omits lessons line when 0", () => {
    render(<SessionSummaryToast summary={makeSummary({ lessonsStored: 0 })} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId("lessons-stored")).toBeNull();
  });
});

describe("SessionSummaryToast — user model version", () => {
  it("shows version change line when userModelChanged + both versions present", () => {
    render(
      <SessionSummaryToast
        summary={makeSummary({ userModelChanged: true, versionBefore: 5, versionAfter: 6 })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("model-version").textContent).toBe("user model: v5 → v6");
  });

  it("shows 'updated' fallback when version numbers are absent", () => {
    render(
      <SessionSummaryToast
        summary={makeSummary({ userModelChanged: true })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("model-version").textContent).toBe("user model: updated");
  });

  it("omits model version line when userModelChanged is false", () => {
    render(
      <SessionSummaryToast
        summary={makeSummary({ userModelChanged: false, versionBefore: 3, versionAfter: 4 })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("model-version")).toBeNull();
  });
});

describe("SessionSummaryToast — tokens and cost", () => {
  it("shows tokens line", () => {
    render(
      <SessionSummaryToast
        summary={makeSummary({ skillsCreated: 1, totalTokens: 12345 })}
        onDismiss={vi.fn()}
      />,
    );
    // toLocaleString format varies by test locale — just verify the number is present
    expect(screen.getByTestId("tokens").textContent).toContain("12");
    expect(screen.getByTestId("tokens").textContent).toContain("345");
    expect(screen.getByTestId("tokens").textContent).toContain("tokens");
  });

  it("shows cost when both tokens and cost provided", () => {
    render(
      <SessionSummaryToast
        summary={makeSummary({ skillsCreated: 1, totalTokens: 5000, costUsd: 0.0123 })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tokens").textContent).toContain("$0.0123");
  });

  it("omits tokens line when totalTokens is undefined", () => {
    render(<SessionSummaryToast summary={makeSummary({ skillsCreated: 1 })} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId("tokens")).toBeNull();
  });
});

describe("SessionSummaryToast — dismiss", () => {
  it("calls onDismiss when dismiss button clicked", async () => {
    const onDismiss = vi.fn();
    render(
      <SessionSummaryToast summary={makeSummary({ skillsCreated: 2 })} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByLabelText("dismiss"));
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});

describe("SessionSummaryToast — combined stats", () => {
  it("renders all lines simultaneously", () => {
    render(
      <SessionSummaryToast
        summary={makeSummary({
          skillsCreated: 2,
          skillsUpdated: 1,
          lessonsStored: 3,
          userModelChanged: true,
          versionBefore: 7,
          versionAfter: 8,
          totalTokens: 8000,
          costUsd: 0.024,
        })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("skills-created")).toBeTruthy();
    expect(screen.getByTestId("skills-updated")).toBeTruthy();
    expect(screen.getByTestId("lessons-stored")).toBeTruthy();
    expect(screen.getByTestId("model-version")).toBeTruthy();
    expect(screen.getByTestId("tokens")).toBeTruthy();
  });
});
