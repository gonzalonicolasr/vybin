// VoiceModeToggle unit tests.
// Covers: initial render, toggle state, click invokes voice_mode_set, accessibility.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VoiceModeToggle } from "./VoiceModeToggle";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
});

describe("VoiceModeToggle", () => {
  it("renders mic button with label", () => {
    render(<VoiceModeToggle />);
    expect(screen.getByText("mic")).toBeTruthy();
  });

  it("renders in off state by default", () => {
    const { container } = render(<VoiceModeToggle />);
    const btn = container.querySelector(".voice-toggle");
    expect(btn?.classList.contains("voice-toggle-off")).toBe(true);
    expect(btn?.classList.contains("voice-toggle-active")).toBe(false);
  });

  it("renders in active state when initialActive=true", () => {
    const { container } = render(<VoiceModeToggle initialActive={true} />);
    const btn = container.querySelector(".voice-toggle");
    expect(btn?.classList.contains("voice-toggle-active")).toBe(true);
  });

  it("has correct aria-pressed when off", () => {
    render(<VoiceModeToggle />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("has correct aria-pressed when on", () => {
    render(<VoiceModeToggle initialActive={true} />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("tooltip reflects off state", () => {
    render(<VoiceModeToggle />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("title")).toBe("Voice mode: OFF");
  });

  it("tooltip reflects on state", () => {
    render(<VoiceModeToggle initialActive={true} />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("title")).toBe("Voice mode: ON");
  });

  it("clicking off->on calls voice_mode_set with active:true", async () => {
    render(<VoiceModeToggle />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("voice_mode_set", { active: true });
    });
  });

  it("clicking on->off calls voice_mode_set with active:false", async () => {
    render(<VoiceModeToggle initialActive={true} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("voice_mode_set", { active: false });
    });
  });

  it("toggles to active state after click (optimistic update)", async () => {
    const { container } = render(<VoiceModeToggle />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      const btn = container.querySelector(".voice-toggle");
      expect(btn?.classList.contains("voice-toggle-active")).toBe(true);
    });
  });

  it("toggles back to off state on second click", async () => {
    const { container } = render(<VoiceModeToggle />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(container.querySelector(".voice-toggle-active")).toBeTruthy();
    });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(container.querySelector(".voice-toggle-off")).toBeTruthy();
    });
  });

  it("still toggles even when invoke throws (optimistic)", async () => {
    mockInvoke.mockRejectedValue(new Error("stub error"));
    const { container } = render(<VoiceModeToggle />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      const btnEl = container.querySelector(".voice-toggle");
      expect(btnEl?.classList.contains("voice-toggle-active")).toBe(true);
    });
  });

  it("aria-label changes based on state", async () => {
    render(<VoiceModeToggle />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toContain("off");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.getAttribute("aria-label")).toContain("on");
    });
  });
});
