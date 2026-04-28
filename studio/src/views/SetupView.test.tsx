// SetupView unit tests.
// Covers: multi-step navigation, step validation, key save flow, sandbox test, apply flow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SetupView } from "./SetupView";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
});

// Helper to click the "next" button
function clickNext(): void {
  const btn = screen.getByText("next");
  fireEvent.click(btn);
}

describe("SetupView — step 1: welcome", () => {
  it("renders welcome title and provider grid", () => {
    render(<SetupView onComplete={vi.fn()} />);
    expect(screen.getByText("WELCOME TO VYBIN")).toBeTruthy();
    expect(screen.getByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Gemini")).toBeTruthy();
    expect(screen.getByText("Groq")).toBeTruthy();
  });

  it("next button is disabled when no providers selected", () => {
    render(<SetupView onComplete={vi.fn()} />);
    const nextBtn = screen.getByText("next");
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("next button enables after selecting at least one provider", () => {
    render(<SetupView onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Anthropic"));
    const nextBtn = screen.getByText("next");
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("selecting a provider highlights it (active class)", () => {
    const { container } = render(<SetupView onComplete={vi.fn()} />);
    const cards = container.querySelectorAll(".setup-provider-card");
    // Anthropic is first
    fireEvent.click(cards[0]!);
    expect(cards[0]!.classList.contains("setup-provider-card-active")).toBe(true);
  });

  it("deselecting a provider removes active class", () => {
    const { container } = render(<SetupView onComplete={vi.fn()} />);
    const cards = container.querySelectorAll(".setup-provider-card");
    fireEvent.click(cards[0]!);
    expect(cards[0]!.classList.contains("setup-provider-card-active")).toBe(true);
    fireEvent.click(cards[0]!);
    expect(cards[0]!.classList.contains("setup-provider-card-active")).toBe(false);
  });

  it("shows 'Select at least one provider' hint when none are selected", () => {
    render(<SetupView onComplete={vi.fn()} />);
    expect(screen.getByText(/Select at least one provider/)).toBeTruthy();
  });

  it("navigates to api-keys step after selecting a provider and clicking next", async () => {
    render(<SetupView onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Anthropic"));
    clickNext();
    await waitFor(() => {
      expect(screen.getByText("API KEYS")).toBeTruthy();
    });
  });
});

describe("SetupView — step 2: api-keys", () => {
  async function goToApiKeys(): Promise<void> {
    render(<SetupView onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Anthropic"));
    clickNext();
    await waitFor(() => screen.getByText("API KEYS"));
  }

  it("shows input for each selected provider", async () => {
    await goToApiKeys();
    // Anthropic was selected — should see its password input
    const inputs = screen.getAllByPlaceholderText(/ANTHROPIC_API_KEY/);
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("save key button is disabled when input is empty or too short", async () => {
    await goToApiKeys();
    const saveBtn = screen.getByText("save key");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("save key button enables when at least 10 chars are entered", async () => {
    await goToApiKeys();
    const input = screen.getByPlaceholderText(/ANTHROPIC_API_KEY/);
    fireEvent.change(input, { target: { value: "sk-ant-api01-xyz123456789" } });
    const saveBtn = screen.getByText("save key");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("save key calls credentials_add invoke with correct args", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await goToApiKeys();
    const input = screen.getByPlaceholderText(/ANTHROPIC_API_KEY/);
    fireEvent.change(input, { target: { value: "sk-ant-api01-xyz123456789" } });
    fireEvent.click(screen.getByText("save key"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("credentials_add", expect.objectContaining({
        provider: "anthropic",
        apiKey: "sk-ant-api01-xyz123456789",
      }));
    });
  });

  it("shows 'saved' status after successful key save", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await goToApiKeys();
    const input = screen.getByPlaceholderText(/ANTHROPIC_API_KEY/);
    fireEvent.change(input, { target: { value: "sk-ant-api01-xyz123456789" } });
    fireEvent.click(screen.getByText("save key"));
    await waitFor(() => {
      expect(screen.getByText("saved")).toBeTruthy();
    });
  });

  it("shows error status when credentials_add throws", async () => {
    mockInvoke.mockRejectedValue(new Error("network error"));
    await goToApiKeys();
    const input = screen.getByPlaceholderText(/ANTHROPIC_API_KEY/);
    fireEvent.change(input, { target: { value: "sk-ant-api01-xyz123456789" } });
    fireEvent.click(screen.getByText("save key"));
    await waitFor(() => {
      expect(screen.getByText("error")).toBeTruthy();
    });
  });

  it("can navigate to sandbox step by clicking next", async () => {
    await goToApiKeys();
    clickNext();
    await waitFor(() => {
      expect(screen.getByText("SANDBOX")).toBeTruthy();
    });
  });
});

describe("SetupView — step 3: sandbox", () => {
  async function goToSandbox(): Promise<void> {
    render(<SetupView onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Anthropic"));
    clickNext();
    await waitFor(() => screen.getByText("API KEYS"));
    clickNext();
    await waitFor(() => screen.getByText("SANDBOX"));
  }

  it("renders sandbox radio buttons", async () => {
    await goToSandbox();
    expect(screen.getByDisplayValue("local")).toBeTruthy();
    expect(screen.getByDisplayValue("docker")).toBeTruthy();
    expect(screen.getByDisplayValue("ssh")).toBeTruthy();
  });

  it("selecting docker shows docker sub-form", async () => {
    await goToSandbox();
    fireEvent.click(screen.getByDisplayValue("docker"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("alpine:3")).toBeTruthy();
    });
  });

  it("selecting ssh shows ssh sub-form", async () => {
    await goToSandbox();
    fireEvent.click(screen.getByDisplayValue("ssh"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/192\.168/)).toBeTruthy();
    });
  });

  it("health check button calls sandbox_test invoke", async () => {
    mockInvoke.mockResolvedValue({ ok: true });
    await goToSandbox();
    fireEvent.click(screen.getByText("health check"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("sandbox_test", expect.objectContaining({
        kind: "local",
      }));
    });
  });

  it("shows 'sandbox reachable' on successful health check", async () => {
    mockInvoke.mockResolvedValue({ ok: true });
    await goToSandbox();
    fireEvent.click(screen.getByText("health check"));
    await waitFor(() => {
      expect(screen.getByText("sandbox reachable")).toBeTruthy();
    });
  });

  it("shows error message on failed health check", async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: "docker not running" });
    await goToSandbox();
    fireEvent.click(screen.getByText("health check"));
    await waitFor(() => {
      expect(screen.getByText("docker not running")).toBeTruthy();
    });
  });
});

describe("SetupView — step 4: model", () => {
  async function goToModel(): Promise<void> {
    render(<SetupView onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Anthropic"));
    clickNext();
    await waitFor(() => screen.getByText("API KEYS"));
    clickNext();
    await waitFor(() => screen.getByText("SANDBOX"));
    clickNext();
    await waitFor(() => screen.getByText("DEFAULT MODEL"));
  }

  it("shows model title", async () => {
    await goToModel();
    expect(screen.getByText("DEFAULT MODEL")).toBeTruthy();
  });

  it("shows preferred provider dropdown populated with selected providers", async () => {
    await goToModel();
    // Anthropic was selected in step 1 — the select should contain "Anthropic" option text
    const options = document.querySelectorAll("select option");
    const values = Array.from(options).map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain("anthropic");
  });

  it("shows temperature slider", async () => {
    await goToModel();
    const slider = document.querySelector("input[type='range']");
    expect(slider).toBeTruthy();
  });
});

describe("SetupView — step 5: gateway", () => {
  async function goToGateway(): Promise<void> {
    render(<SetupView onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Anthropic"));
    for (let i = 0; i < 3; i++) {
      clickNext();
      await waitFor(() => {}); // Allow state updates
    }
    await waitFor(() => screen.getByText("DEFAULT MODEL"));
    clickNext();
    await waitFor(() => screen.getByText("GATEWAY (OPTIONAL)"));
  }

  it("renders gateway step with disabled toggle by default", async () => {
    await goToGateway();
    const toggle = screen.getByRole("checkbox");
    expect((toggle as HTMLInputElement).checked).toBe(false);
  });

  it("enabling gateway shows platform config fields", async () => {
    await goToGateway();
    const toggle = screen.getByRole("checkbox");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByText("TELEGRAM")).toBeTruthy();
      expect(screen.getByText("DISCORD")).toBeTruthy();
    });
  });

  it("skip button navigates to review when gateway disabled", async () => {
    await goToGateway();
    const skipBtn = screen.getByText("skip");
    fireEvent.click(skipBtn);
    await waitFor(() => {
      expect(screen.getByText("REVIEW & APPLY")).toBeTruthy();
    });
  });
});

describe("SetupView — step 6: review & apply", () => {
  async function goToReview(): Promise<void> {
    render(<SetupView onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Anthropic"));
    clickNext();
    await waitFor(() => screen.getByText("API KEYS"));
    clickNext();
    await waitFor(() => screen.getByText("SANDBOX"));
    clickNext();
    await waitFor(() => screen.getByText("DEFAULT MODEL"));
    clickNext();
    await waitFor(() => screen.getByText("GATEWAY (OPTIONAL)"));
    fireEvent.click(screen.getByText("skip"));
    await waitFor(() => screen.getByText("REVIEW & APPLY"));
  }

  it("shows review summary with selected providers", async () => {
    await goToReview();
    // The review grid shows "providers" row
    expect(screen.getByText("providers")).toBeTruthy();
    // Provider value appears in review row — use getAllByText since it may appear multiple times
    const anthropicItems = screen.getAllByText("Anthropic");
    expect(anthropicItems.length).toBeGreaterThan(0);
  });

  it("shows sandbox row", async () => {
    await goToReview();
    expect(screen.getByText("sandbox")).toBeTruthy();
    expect(screen.getByText("local")).toBeTruthy();
  });

  it("clicking Apply & Start calls restart_session invoke", async () => {
    mockInvoke.mockResolvedValue({ ok: true });
    await goToReview();
    fireEvent.click(screen.getByText("apply & start"));
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.map(([cmd]) => cmd);
      expect(calls).toContain("restart_session");
    });
  });

  it("shows check results after apply", async () => {
    mockInvoke.mockResolvedValue({ ok: true });
    await goToReview();
    fireEvent.click(screen.getByText("apply & start"));
    await waitFor(() => {
      // Should see at least one check result
      const checks = document.querySelectorAll(".setup-check-row");
      expect(checks.length).toBeGreaterThan(0);
    });
  });

  it("calls onComplete callback after successful apply", async () => {
    const onComplete = vi.fn();
    mockInvoke.mockResolvedValue({ ok: true });
    render(<SetupView onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Anthropic"));
    clickNext();
    await waitFor(() => screen.getByText("API KEYS"));
    clickNext();
    await waitFor(() => screen.getByText("SANDBOX"));
    clickNext();
    await waitFor(() => screen.getByText("DEFAULT MODEL"));
    clickNext();
    await waitFor(() => screen.getByText("GATEWAY (OPTIONAL)"));
    fireEvent.click(screen.getByText("skip"));
    await waitFor(() => screen.getByText("apply & start"));
    fireEvent.click(screen.getByText("apply & start"));
    // onComplete fires after 800ms timeout in the component
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });
  });
});

describe("SetupView — back navigation", () => {
  it("back button navigates to previous step", async () => {
    render(<SetupView onComplete={vi.fn()} />);
    fireEvent.click(screen.getByText("Anthropic"));
    clickNext();
    await waitFor(() => screen.getByText("API KEYS"));
    fireEvent.click(screen.getByText("back"));
    await waitFor(() => {
      expect(screen.getByText("WELCOME TO VYBIN")).toBeTruthy();
    });
  });

  it("back button is hidden on first step", () => {
    render(<SetupView onComplete={vi.fn()} />);
    expect(screen.queryByText("back")).toBeNull();
  });
});
