// setup-flow.test.tsx — integration tests for first-launch detection and wizard completion.
//
// Tests that:
//   1. SetupView is auto-shown when no API keys and setupCompleted is not "true"
//   2. Completing wizard sets setupCompleted flag
//   3. SetupView is NOT shown when keys exist (user already configured)
//   4. SetupView is NOT shown when setupCompleted="true"

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { SetupView } from "../views/SetupView";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri fs plugin
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue("{}"),
  exists: vi.fn().mockResolvedValue(false),
  BaseDirectory: { Home: 3 },
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue({ ok: true });
});

// ─── Harness simulating App's first-launch detection ──────────────────────────

interface FirstLaunchHarnessProps {
  hasApiKey: boolean;
  isSetupComplete: boolean;
}

function FirstLaunchHarness({ hasApiKey, isSetupComplete }: FirstLaunchHarnessProps): React.JSX.Element {
  // Mirrors App.tsx logic:
  // Show setup when: setupCompleted !== "true" AND no API keys
  const shouldShowSetup = !isSetupComplete && !hasApiKey;

  const [setupCompleted, setSetupCompleted] = useState(isSetupComplete);
  const [showSetup, setShowSetup] = useState(shouldShowSetup);

  const handleComplete = (): void => {
    setSetupCompleted(true);
    setShowSetup(false);
  };

  return (
    <div>
      {showSetup ? (
        <div data-testid="setup-visible">
          <SetupView onComplete={handleComplete} />
        </div>
      ) : (
        <div data-testid="main-ui">
          <span>main UI — setup complete: {String(setupCompleted)}</span>
        </div>
      )}
    </div>
  );
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("First-launch detection", () => {
  it("shows setup when no API key and setup not complete", () => {
    render(<FirstLaunchHarness hasApiKey={false} isSetupComplete={false} />);
    expect(screen.getByTestId("setup-visible")).toBeTruthy();
    expect(screen.getByText("WELCOME TO CERO STUDIO")).toBeTruthy();
  });

  it("does NOT show setup when API key exists", () => {
    render(<FirstLaunchHarness hasApiKey={true} isSetupComplete={false} />);
    expect(screen.queryByTestId("setup-visible")).toBeNull();
    expect(screen.getByTestId("main-ui")).toBeTruthy();
  });

  it("does NOT show setup when setupCompleted is true", () => {
    render(<FirstLaunchHarness hasApiKey={false} isSetupComplete={true} />);
    expect(screen.queryByTestId("setup-visible")).toBeNull();
    expect(screen.getByTestId("main-ui")).toBeTruthy();
  });

  it("main UI shows even when both conditions prevent setup", () => {
    render(<FirstLaunchHarness hasApiKey={true} isSetupComplete={true} />);
    expect(screen.getByTestId("main-ui")).toBeTruthy();
  });
});

describe("Completing wizard transitions to main UI", () => {
  async function completeWizard(): Promise<void> {
    render(<FirstLaunchHarness hasApiKey={false} isSetupComplete={false} />);

    // Step 1: select Anthropic + next
    await waitFor(() => screen.getByText("WELCOME TO VYBIN"));
    fireEvent.click(screen.getByText("Anthropic"));
    fireEvent.click(screen.getByText("next"));

    // Step 2: api-keys + next (skip saving for simplicity)
    await waitFor(() => screen.getByText("API KEYS"));
    fireEvent.click(screen.getByText("next"));

    // Step 3: sandbox + next
    await waitFor(() => screen.getByText("SANDBOX"));
    fireEvent.click(screen.getByText("next"));

    // Step 4: model + next
    await waitFor(() => screen.getByText("DEFAULT MODEL"));
    fireEvent.click(screen.getByText("next"));

    // Step 5: gateway + skip
    await waitFor(() => screen.getByText("GATEWAY (OPTIONAL)"));
    fireEvent.click(screen.getByText("skip"));

    // Step 6: review + apply
    await waitFor(() => screen.getByText("REVIEW & APPLY"));
    fireEvent.click(screen.getByText("apply & start"));
  }

  it("hides setup and shows main UI after apply", async () => {
    await completeWizard();
    await waitFor(() => {
      expect(screen.queryByTestId("setup-visible")).toBeNull();
      expect(screen.getByTestId("main-ui")).toBeTruthy();
    }, { timeout: 2000 });
  });

  it("sets setupCompleted flag after completion", async () => {
    await completeWizard();
    await waitFor(() => {
      expect(screen.getByText(/setup complete: true/)).toBeTruthy();
    }, { timeout: 2000 });
  });

  it("calls restart_session during apply", async () => {
    await completeWizard();
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.map(([cmd]) => cmd);
      expect(calls).toContain("restart_session");
    }, { timeout: 2000 });
  });
});

describe("SetupView standalone", () => {
  it("progress bar is at ~17% on first step", () => {
    const { container } = render(<SetupView onComplete={vi.fn()} />);
    const fill = container.querySelector(".setup-progress-fill") as HTMLElement;
    const width = parseFloat(fill?.style?.width ?? "0");
    // Step 1 of 6: (1/6)*100 = 16.67%
    expect(width).toBeGreaterThan(15);
    expect(width).toBeLessThan(20);
  });

  it("progress bar reaches 100% on last step", async () => {
    const { container } = render(<SetupView onComplete={vi.fn()} />);

    // Step 1: Select provider + advance
    fireEvent.click(screen.getByText("Anthropic"));
    fireEvent.click(screen.getByText("next"));
    await waitFor(() => screen.getByText("API KEYS"));

    // Step 2 -> 3
    fireEvent.click(screen.getByText("next"));
    await waitFor(() => screen.getByText("SANDBOX"));

    // Step 3 -> 4
    fireEvent.click(screen.getByText("next"));
    await waitFor(() => screen.getByText("DEFAULT MODEL"));

    // Step 4 -> 5
    fireEvent.click(screen.getByText("next"));
    await waitFor(() => screen.getByText("GATEWAY (OPTIONAL)"));

    // Step 5 -> 6 (skip)
    fireEvent.click(screen.getByText("skip"));
    await waitFor(() => screen.getByText("REVIEW & APPLY"));

    const fill = container.querySelector(".setup-progress-fill") as HTMLElement;
    const width = parseFloat(fill?.style?.width ?? "0");
    expect(width).toBe(100);
  });

  it("step tabs render for all 6 steps", () => {
    render(<SetupView onComplete={vi.fn()} />);
    // Each tab should appear
    expect(screen.getByText(/1.*PROVIDERS/)).toBeTruthy();
    expect(screen.getByText(/2.*API KEYS/)).toBeTruthy();
    expect(screen.getByText(/3.*SANDBOX/)).toBeTruthy();
    expect(screen.getByText(/4.*MODEL/)).toBeTruthy();
    expect(screen.getByText(/5.*GATEWAY/)).toBeTruthy();
    expect(screen.getByText(/6.*REVIEW/)).toBeTruthy();
  });
});
