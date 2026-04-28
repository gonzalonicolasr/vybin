import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClarifyModal } from "./ClarifyModal";
import type { ClarifyRequest, ClarifyResponse } from "./ipc-types";

// ─── mock Markdown ───────────────────────────────────────────────────────────

vi.mock("./Markdown", () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

const BASE_REQUEST: ClarifyRequest = {
  type: "clarify-request",
  tab_id: "tab-1",
  id: 42,
  question: "Which approach should I use?",
  choices: ["Option A", "Option B", "Option C"],
  allowFree: false,
};

const FREE_TEXT_REQUEST: ClarifyRequest = {
  type: "clarify-request",
  tab_id: "tab-1",
  id: 7,
  question: "What is your name?",
  allowFree: true,
};

const MIXED_REQUEST: ClarifyRequest = {
  type: "clarify-request",
  tab_id: "tab-1",
  id: 99,
  question: "Pick or type:",
  choices: ["Alpha", "Beta"],
  allowFree: true,
};

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ClarifyModal", () => {

  describe("render — with choices", () => {
    it("renders the question", () => {
      const onResolve = vi.fn();
      render(<ClarifyModal request={BASE_REQUEST} onResolve={onResolve} onCancel={vi.fn()} />);
      expect(screen.getByText("Which approach should I use?")).toBeTruthy();
    });

    it("renders all choice buttons", () => {
      render(<ClarifyModal request={BASE_REQUEST} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Option A")).toBeTruthy();
      expect(screen.getByText("Option B")).toBeTruthy();
      expect(screen.getByText("Option C")).toBeTruthy();
    });

    it("renders shortcut key labels 1–3", () => {
      render(<ClarifyModal request={BASE_REQUEST} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("1")).toBeTruthy();
      expect(screen.getByText("2")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
    });

    it("first choice is selected by default", () => {
      render(<ClarifyModal request={BASE_REQUEST} onResolve={vi.fn()} onCancel={vi.fn()} />);
      const choices = document.querySelectorAll(".clarify-choice");
      expect(choices[0]?.classList.contains("clarify-choice-selected")).toBe(true);
      expect(choices[1]?.classList.contains("clarify-choice-selected")).toBe(false);
    });

    it("clicking a choice selects it", () => {
      render(<ClarifyModal request={BASE_REQUEST} onResolve={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByText("Option B"));
      const choices = document.querySelectorAll(".clarify-choice");
      expect(choices[1]?.classList.contains("clarify-choice-selected")).toBe(true);
      expect(choices[0]?.classList.contains("clarify-choice-selected")).toBe(false);
    });

    it("does NOT render textarea when allowFree is false", () => {
      render(<ClarifyModal request={BASE_REQUEST} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(document.querySelector(".clarify-textarea")).toBeNull();
    });

    it("renders CLARIFICATION NEEDED heading", () => {
      render(<ClarifyModal request={BASE_REQUEST} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("CLARIFICATION NEEDED")).toBeTruthy();
    });
  });

  describe("render — free text only", () => {
    it("renders textarea", () => {
      render(<ClarifyModal request={FREE_TEXT_REQUEST} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(document.querySelector(".clarify-textarea")).toBeTruthy();
    });

    it("does NOT render choice buttons", () => {
      render(<ClarifyModal request={FREE_TEXT_REQUEST} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(document.querySelectorAll(".clarify-choice").length).toBe(0);
    });
  });

  describe("render — mixed (choices + free text)", () => {
    it("renders both choices and textarea", () => {
      render(<ClarifyModal request={MIXED_REQUEST} onResolve={vi.fn()} onCancel={vi.fn()} />);
      expect(document.querySelectorAll(".clarify-choice").length).toBe(2);
      expect(document.querySelector(".clarify-textarea")).toBeTruthy();
    });
  });

  describe("send button — choice selected", () => {
    it("calls onResolve with selected choice and choiceIndex", () => {
      const onResolve = vi.fn();
      render(<ClarifyModal request={BASE_REQUEST} onResolve={onResolve} onCancel={vi.fn()} />);
      // First choice is selected by default
      fireEvent.click(screen.getByText("send"));
      expect(onResolve).toHaveBeenCalledWith<[ClarifyResponse]>({
        type: "clarify-response",
        id: 42,
        answer: "Option A",
        choiceIndex: 0,
      });
    });

    it("calls onResolve with the clicked choice", () => {
      const onResolve = vi.fn();
      render(<ClarifyModal request={BASE_REQUEST} onResolve={onResolve} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByText("Option C"));
      fireEvent.click(screen.getByText("send"));
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ answer: "Option C", choiceIndex: 2 }),
      );
    });
  });

  describe("send button — free text", () => {
    it("calls onResolve with typed text", () => {
      const onResolve = vi.fn();
      render(<ClarifyModal request={FREE_TEXT_REQUEST} onResolve={onResolve} onCancel={vi.fn()} />);
      const textarea = screen.getByPlaceholderText(/Type your answer/);
      fireEvent.change(textarea, { target: { value: "my custom answer" } });
      fireEvent.click(screen.getByText("send"));
      expect(onResolve).toHaveBeenCalledWith<[ClarifyResponse]>({
        type: "clarify-response",
        id: 7,
        answer: "my custom answer",
      });
    });

    it("trims whitespace from answer", () => {
      const onResolve = vi.fn();
      render(<ClarifyModal request={FREE_TEXT_REQUEST} onResolve={onResolve} onCancel={vi.fn()} />);
      const textarea = screen.getByPlaceholderText(/Type your answer/);
      fireEvent.change(textarea, { target: { value: "  spaced  " } });
      fireEvent.click(screen.getByText("send"));
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ answer: "spaced" }),
      );
    });
  });

  describe("double-click choice — fast confirm", () => {
    it("calls onResolve and onCancel immediately", () => {
      const onResolve = vi.fn();
      const onCancel = vi.fn();
      render(<ClarifyModal request={BASE_REQUEST} onResolve={onResolve} onCancel={onCancel} />);
      fireEvent.dblClick(screen.getByText("Option B"));
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ answer: "Option B", choiceIndex: 1 }),
      );
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe("cancel button", () => {
    it("calls onResolve with answer:null and reason:'user cancelled'", () => {
      const onResolve = vi.fn();
      const onCancel = vi.fn();
      render(<ClarifyModal request={BASE_REQUEST} onResolve={onResolve} onCancel={onCancel} />);
      fireEvent.click(screen.getByText("cancel (Esc)"));
      expect(onResolve).toHaveBeenCalledWith<[ClarifyResponse]>({
        type: "clarify-response",
        id: 42,
        answer: null,
        reason: "user cancelled",
      });
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe("keyboard — Esc", () => {
    it("fires cancel on Escape key", () => {
      const onResolve = vi.fn();
      const onCancel = vi.fn();
      render(<ClarifyModal request={BASE_REQUEST} onResolve={onResolve} onCancel={onCancel} />);
      fireEvent.keyDown(window, { key: "Escape", bubbles: true });
      expect(onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ answer: null }),
      );
    });
  });

  describe("keyboard — Enter", () => {
    it("sends the selected choice when Enter is pressed outside textarea", async () => {
      const onResolve = vi.fn();
      render(<ClarifyModal request={BASE_REQUEST} onResolve={onResolve} onCancel={vi.fn()} />);
      // Focus something other than the textarea (there is none in this fixture)
      document.body.focus();
      fireEvent.keyDown(window, { key: "Enter", bubbles: true });
      await waitFor(() => {
        expect(onResolve).toHaveBeenCalledWith(
          expect.objectContaining({ type: "clarify-response", id: 42 }),
        );
      });
    });
  });
});
