// modal-flow.test.tsx — integration test for the clarify/approval request→response cycle.
//
// Tests that:
//   1. Incoming IPC events cause the correct modal to appear
//   2. Responding invokes the `respond_request` Tauri command with correct payload
//   3. Modal is dismissed after response
//   4. Multiple queued requests are served FIFO

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useState } from "react";
import { ClarifyModal } from "../ClarifyModal";
import { ApprovalModal } from "../ApprovalModal";
import { invoke } from "@tauri-apps/api/core";
import type { ClarifyRequest, ApprovalRequest, ClarifyResponse, ApprovalResponse } from "../ipc-types";

// ─── mocks ───────────────────────────────────────────────────────────────────

vi.mock("../Markdown", () => ({
  Markdown: ({ text }: { text: string }) => <span>{text}</span>,
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockClear().mockResolvedValue(undefined);
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeClarifyReq(overrides: Partial<ClarifyRequest> = {}): ClarifyRequest {
  return {
    type: "clarify-request",
    tab_id: "tab-1",
    id: 1,
    question: "Should I proceed?",
    choices: ["Yes", "No"],
    allowFree: false,
    ...overrides,
  };
}

function makeApprovalReq(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    type: "approval-request",
    tab_id: "tab-1",
    id: 2,
    command: "git push --force origin main",
    dangerLevel: "high",
    category: "vcs",
    ...overrides,
  };
}

// ─── Stateful wrapper that simulates App's queue management ──────────────────

function ClarifyFlowHarness({
  request,
  onInvokeCapture,
}: {
  request: ClarifyRequest;
  onInvokeCapture: (payload: ClarifyResponse) => void;
}): React.JSX.Element {
  const [visible, setVisible] = useState(true);

  if (!visible) return <div data-testid="modal-gone" />;

  const handleResolve = (response: ClarifyResponse): void => {
    onInvokeCapture(response);
    void invoke("respond_request", {
      tabId: request.tab_id,
      payload: response,
    });
    setVisible(false);
  };

  return (
    <ClarifyModal
      request={request}
      onResolve={handleResolve}
      onCancel={(): void => setVisible(false)}
    />
  );
}

function ApprovalFlowHarness({
  request,
  onInvokeCapture,
}: {
  request: ApprovalRequest;
  onInvokeCapture: (payload: ApprovalResponse) => void;
}): React.JSX.Element {
  const [visible, setVisible] = useState(true);

  if (!visible) return <div data-testid="modal-gone" />;

  const handleResolve = (response: ApprovalResponse): void => {
    onInvokeCapture(response);
    void invoke("respond_request", {
      tabId: request.tab_id,
      payload: response,
    });
    setVisible(false);
  };

  return (
    <ApprovalModal
      request={request}
      onResolve={handleResolve}
      onCancel={(): void => setVisible(false)}
    />
  );
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ClarifyModal flow", () => {

  it("renders when request is set", () => {
    const req = makeClarifyReq();
    render(<ClarifyFlowHarness request={req} onInvokeCapture={vi.fn()} />);
    expect(screen.getByText("Should I proceed?")).toBeTruthy();
  });

  it("choosing a choice and sending invokes respond_request with correct payload", async () => {
    const captured: ClarifyResponse[] = [];
    const req = makeClarifyReq();
    render(<ClarifyFlowHarness request={req} onInvokeCapture={(r) => captured.push(r)} />);

    fireEvent.click(screen.getByText("No"));
    fireEvent.click(screen.getByText("send"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("respond_request", {
        tabId: "tab-1",
        payload: expect.objectContaining({
          type: "clarify-response",
          id: 1,
          answer: "No",
          choiceIndex: 1,
        }),
      });
    });
  });

  it("modal disappears after resolving", async () => {
    const req = makeClarifyReq();
    render(<ClarifyFlowHarness request={req} onInvokeCapture={vi.fn()} />);

    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(screen.getByText("send"));

    await waitFor(() => {
      expect(screen.getByTestId("modal-gone")).toBeTruthy();
    });
  });

  it("cancel sends answer:null to respond_request via onResolve", async () => {
    const req = makeClarifyReq();
    render(<ClarifyFlowHarness request={req} onInvokeCapture={vi.fn()} />);

    fireEvent.click(screen.getByText("cancel (Esc)"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("respond_request", {
        tabId: "tab-1",
        payload: expect.objectContaining({
          type: "clarify-response",
          id: 1,
          answer: null,
        }),
      });
    });
  });

  it("free-text response sends the typed text", async () => {
    const req = makeClarifyReq({ choices: undefined, allowFree: true });
    render(<ClarifyFlowHarness request={req} onInvokeCapture={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Type your answer/);
    fireEvent.change(textarea, { target: { value: "detailed response" } });
    fireEvent.click(screen.getByText("send"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("respond_request", {
        tabId: "tab-1",
        payload: expect.objectContaining({
          answer: "detailed response",
        }),
      });
    });
  });
});

describe("ApprovalModal flow", () => {

  it("renders when request is set", () => {
    const req = makeApprovalReq();
    render(<ApprovalFlowHarness request={req} onInvokeCapture={vi.fn()} />);
    expect(screen.getByText("APPROVAL REQUIRED")).toBeTruthy();
    expect(screen.getByText("git push --force origin main")).toBeTruthy();
  });

  it("allow-once invokes respond_request with approved:true, rememberForSession:false", async () => {
    const req = makeApprovalReq();
    render(<ApprovalFlowHarness request={req} onInvokeCapture={vi.fn()} />);

    fireEvent.click(screen.getByTestId("allow-once-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("respond_request", {
        tabId: "tab-1",
        payload: expect.objectContaining({
          type: "approval-response",
          id: 2,
          approved: true,
          rememberForSession: false,
        }),
      });
    });
  });

  it("allow-always invokes respond_request with rememberForSession:true", async () => {
    const req = makeApprovalReq();
    render(<ApprovalFlowHarness request={req} onInvokeCapture={vi.fn()} />);

    fireEvent.click(screen.getByTestId("allow-always-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("respond_request", {
        tabId: "tab-1",
        payload: expect.objectContaining({
          approved: true,
          rememberForSession: true,
        }),
      });
    });
  });

  it("deny invokes respond_request with approved:false", async () => {
    const req = makeApprovalReq();
    render(<ApprovalFlowHarness request={req} onInvokeCapture={vi.fn()} />);

    fireEvent.click(screen.getByTestId("deny-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("respond_request", {
        tabId: "tab-1",
        payload: expect.objectContaining({
          approved: false,
        }),
      });
    });
  });

  it("modal disappears after resolution", async () => {
    const req = makeApprovalReq();
    render(<ApprovalFlowHarness request={req} onInvokeCapture={vi.fn()} />);

    fireEvent.click(screen.getByTestId("allow-once-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("modal-gone")).toBeTruthy();
    });
  });

  it("y key shortcut invokes allow-once", async () => {
    const req = makeApprovalReq();
    render(<ApprovalFlowHarness request={req} onInvokeCapture={vi.fn()} />);

    document.body.focus();
    act(() => {
      fireEvent.keyDown(window, { key: "y", bubbles: true });
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("respond_request", {
        tabId: "tab-1",
        payload: expect.objectContaining({ approved: true, rememberForSession: false }),
      });
    });
  });

  it("n key shortcut invokes deny", async () => {
    const req = makeApprovalReq();
    render(<ApprovalFlowHarness request={req} onInvokeCapture={vi.fn()} />);

    document.body.focus();
    act(() => {
      fireEvent.keyDown(window, { key: "n", bubbles: true });
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("respond_request", {
        tabId: "tab-1",
        payload: expect.objectContaining({ approved: false }),
      });
    });
  });
});

describe("FIFO queue simulation", () => {
  // A harness that owns the queue state — mirrors App.tsx's requestQueues Map
  function QueueHarness({ requests }: { requests: ClarifyRequest[] }): React.JSX.Element {
    const [queue, setQueue] = useState<ClarifyRequest[]>(requests);
    const current = queue[0];

    if (!current) return <div data-testid="queue-empty" />;

    return (
      <ClarifyModal
        request={current}
        onResolve={(): void => {
          // On resolve, advance the queue (dequeue head)
          void invoke("respond_request", { tabId: current.tab_id, payload: {} });
          setQueue((q) => q.slice(1));
        }}
        onCancel={(): void => setQueue((q) => q.slice(1))}
      />
    );
  }

  it("renders first request first", () => {
    const req1 = makeClarifyReq({ id: 10, question: "First question?" });
    const req2 = makeClarifyReq({ id: 11, question: "Second question?" });
    render(<QueueHarness requests={[req1, req2]} />);
    expect(screen.getByText("First question?")).toBeTruthy();
    // Second question not visible yet
    expect(screen.queryByText("Second question?")).toBeNull();
  });

  it("advances to second request after first is resolved", async () => {
    const req1 = makeClarifyReq({ id: 10, question: "First question?" });
    const req2 = makeClarifyReq({ id: 11, question: "Second question?" });
    render(<QueueHarness requests={[req1, req2]} />);

    // Resolve first
    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(screen.getByText("send"));

    // Second should now be showing
    await waitFor(() => {
      expect(screen.getByText("Second question?")).toBeTruthy();
    });
  });

  it("clears queue when all resolved", async () => {
    const req1 = makeClarifyReq({ id: 10, question: "Only question?" });
    render(<QueueHarness requests={[req1]} />);

    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(screen.getByText("send"));

    await waitFor(() => {
      expect(screen.getByTestId("queue-empty")).toBeTruthy();
    });
  });

  it("invoke is called once per resolved request", async () => {
    mockInvoke.mockClear();
    const req1 = makeClarifyReq({ id: 10, question: "First?" });
    const req2 = makeClarifyReq({ id: 11, question: "Second?" });
    render(<QueueHarness requests={[req1, req2]} />);

    // Resolve first
    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(screen.getByText("send"));

    await waitFor(() => screen.getByText("Second?"));

    // Resolve second
    fireEvent.click(screen.getByText("Yes"));
    fireEvent.click(screen.getByText("send"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });
});
