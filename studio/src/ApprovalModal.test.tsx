import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalModal } from "./ApprovalModal";
import type { ApprovalRequest, ApprovalResponse } from "./ipc-types";

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    type: "approval-request",
    tab_id: "tab-1",
    id: 1,
    command: "rm -rf /tmp/test-dir",
    dangerLevel: "medium",
    category: "filesystem",
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ApprovalModal", () => {

  describe("render", () => {
    it("renders APPROVAL REQUIRED heading", () => {
      render(<ApprovalModal request={makeRequest()} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("APPROVAL REQUIRED")).toBeTruthy();
    });

    it("renders the command text", () => {
      render(<ApprovalModal request={makeRequest()} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("rm -rf /tmp/test-dir")).toBeTruthy();
    });

    it("renders category badge", () => {
      render(<ApprovalModal request={makeRequest()} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("filesystem")).toBeTruthy();
    });

    it("renders MEDIUM danger badge", () => {
      render(<ApprovalModal request={makeRequest({ dangerLevel: "medium" })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("MEDIUM")).toBeTruthy();
    });

    it("renders description when provided", () => {
      render(<ApprovalModal request={makeRequest({ description: "Cleaning temp files" })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Cleaning temp files")).toBeTruthy();
    });

    it("does not render description section when absent", () => {
      render(<ApprovalModal request={makeRequest({ description: undefined })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.queryByText("DESCRIPTION")).toBeNull();
    });

    it("renders all three action buttons", () => {
      render(<ApprovalModal request={makeRequest()} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByTestId("deny-btn")).toBeTruthy();
      expect(screen.getByTestId("allow-once-btn")).toBeTruthy();
      expect(screen.getByTestId("allow-always-btn")).toBeTruthy();
    });
  });

  describe("danger level visual variants", () => {
    it("shows LOW badge for low danger", () => {
      render(<ApprovalModal request={makeRequest({ dangerLevel: "low" })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("LOW")).toBeTruthy();
    });

    it("shows HIGH badge for high danger", () => {
      render(<ApprovalModal request={makeRequest({ dangerLevel: "high" })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("HIGH")).toBeTruthy();
    });

    it("shows CRITICAL badge for critical danger", () => {
      render(<ApprovalModal request={makeRequest({ dangerLevel: "critical" })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("CRITICAL")).toBeTruthy();
    });

    it("applies correct modal class for critical", () => {
      render(<ApprovalModal request={makeRequest({ dangerLevel: "critical" })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(document.querySelector(".approval-modal-critical")).toBeTruthy();
    });

    it("applies correct modal class for low", () => {
      render(<ApprovalModal request={makeRequest({ dangerLevel: "low" })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(document.querySelector(".approval-modal-low")).toBeTruthy();
    });
  });

  describe("allow once", () => {
    it("calls onResolve with approved:true, rememberForSession:false", () => {
      const onResolve = vi.fn();
      const onCancel = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={onCancel} />);
      fireEvent.click(screen.getByTestId("allow-once-btn"));
      expect(onResolve).toHaveBeenCalledWith<[ApprovalResponse]>({
        type: "approval-response",
        id: 1,
        approved: true,
        rememberForSession: false,
      });
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe("allow always", () => {
    it("calls onResolve with approved:true, rememberForSession:true", () => {
      const onResolve = vi.fn();
      const onCancel = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={onCancel} />);
      fireEvent.click(screen.getByTestId("allow-always-btn"));
      expect(onResolve).toHaveBeenCalledWith<[ApprovalResponse]>({
        type: "approval-response",
        id: 1,
        approved: true,
        rememberForSession: true,
      });
      expect(onCancel).toHaveBeenCalled();
    });

    it("button label includes category name", () => {
      render(<ApprovalModal request={makeRequest({ category: "network" })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText(/always for network/)).toBeTruthy();
    });
  });

  describe("deny", () => {
    it("calls onResolve with approved:false", () => {
      const onResolve = vi.fn();
      const onCancel = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={onCancel} />);
      fireEvent.click(screen.getByTestId("deny-btn"));
      expect(onResolve).toHaveBeenCalledWith<[ApprovalResponse]>({
        type: "approval-response",
        id: 1,
        approved: false,
        rememberForSession: false,
      });
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe("reason field", () => {
    it("includes reason in response when filled", () => {
      const onResolve = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={vi.fn()} />);
      const input = screen.getByPlaceholderText("why are you allowing/denying?");
      fireEvent.change(input, { target: { value: "safe to run" } });
      fireEvent.click(screen.getByTestId("allow-once-btn"));
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "safe to run" }),
      );
    });

    it("omits reason when field is empty", () => {
      const onResolve = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByTestId("allow-once-btn"));
      const call = onResolve.mock.calls[0]?.[0] as ApprovalResponse;
      expect(call.reason).toBeUndefined();
    });
  });

  describe("long command show-more", () => {
    it("shows 'show full' button when command exceeds 300 chars", () => {
      const longCmd = "x".repeat(350);
      render(<ApprovalModal request={makeRequest({ command: longCmd })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText(/show full/)).toBeTruthy();
    });

    it("does not show 'show full' button when command is short", () => {
      render(<ApprovalModal request={makeRequest({ command: "ls -la" })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.queryByText(/show full/)).toBeNull();
    });

    it("toggles to show the full command", () => {
      const longCmd = "y".repeat(350);
      render(<ApprovalModal request={makeRequest({ command: longCmd })} onResolve={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByText(/show full/));
      expect(screen.getByText("show less")).toBeTruthy();
    });
  });

  describe("keyboard shortcuts", () => {
    it("y key fires allow-once", () => {
      const onResolve = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={vi.fn()} />);
      // Ensure focus is not in an input
      document.body.focus();
      fireEvent.keyDown(window, { key: "y", bubbles: true });
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ approved: true, rememberForSession: false }),
      );
    });

    it("a key fires allow-always", () => {
      const onResolve = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={vi.fn()} />);
      document.body.focus();
      fireEvent.keyDown(window, { key: "a", bubbles: true });
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ approved: true, rememberForSession: true }),
      );
    });

    it("n key fires deny", () => {
      const onResolve = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={vi.fn()} />);
      document.body.focus();
      fireEvent.keyDown(window, { key: "n", bubbles: true });
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ approved: false }),
      );
    });

    it("Esc key fires deny", () => {
      const onResolve = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={vi.fn()} />);
      fireEvent.keyDown(window, { key: "Escape", bubbles: true });
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ approved: false }),
      );
    });

    it("keyboard shortcuts are ignored when typing in input", () => {
      const onResolve = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={vi.fn()} />);
      const input = screen.getByPlaceholderText("why are you allowing/denying?");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "y", target: input, bubbles: true });
      expect(onResolve).not.toHaveBeenCalled();
    });

    // P0 safety fix: Enter in reason input must NOT submit allow-once
    it("Enter in reason input does NOT fire allow-once (P0 safety)", () => {
      const onResolve = vi.fn();
      render(<ApprovalModal request={makeRequest()} onResolve={onResolve} onCancel={vi.fn()} />);
      const input = screen.getByPlaceholderText("why are you allowing/denying?");
      fireEvent.change(input, { target: { value: "my deny reason" } });
      fireEvent.keyDown(input, { key: "Enter", bubbles: true });
      expect(onResolve).not.toHaveBeenCalled();
    });
  });
});
