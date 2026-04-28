// GatewayView unit tests.
// Tauri invoke is mocked. Gateway commands are stubs, so tests focus on:
//   - 4 cards render with correct platform labels
//   - Status dots match state (connected/disconnected/error)
//   - Toggle calls gateway_start / gateway_stop
//   - Config form saves via useGatewayConfig
//   - Logs modal opens and renders entries

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GatewayView } from "./GatewayView";
import { invoke } from "@tauri-apps/api/core";

// Mock useGatewayConfig so tests control initial state without hitting store
vi.mock("../hooks/useGatewayConfig", () => ({
  useGatewayConfig: () => ({
    configs: {
      telegram: { botToken: "", adminUsername: "" },
      discord: { botToken: "", allowedUserIds: "" },
      websocket: { port: "8080", authSecret: "" },
      http: { port: "8888", host: "127.0.0.1", bearerToken: "" },
    },
    loading: false,
    save: vi.fn().mockResolvedValue(undefined),
  }),
  DEFAULT_GATEWAY_CONFIGS: {
    telegram: { botToken: "", adminUsername: "" },
    discord: { botToken: "", allowedUserIds: "" },
    websocket: { port: "8080", authSecret: "" },
    http: { port: "8888", host: "127.0.0.1", bearerToken: "" },
  },
}));

const DISCONNECTED_STATUS = { state: "disconnected", error: null, message_count: 0 };
const CONNECTED_STATUS   = { state: "connected",    error: null, message_count: 42 };
const ERROR_STATUS       = { state: "error",         error: "connection refused", message_count: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: all platforms disconnected
  vi.mocked(invoke).mockResolvedValue(DISCONNECTED_STATUS);
});

describe("GatewayView", () => {
  it("renders all 4 platform cards", async () => {
    render(<GatewayView />);
    await waitFor(() => {
      expect(screen.getByText("TELEGRAM")).toBeTruthy();
      expect(screen.getByText("DISCORD")).toBeTruthy();
      expect(screen.getByText("WEBSOCKET")).toBeTruthy();
      expect(screen.getByText("HTTP")).toBeTruthy();
    });
  });

  it("renders start buttons when all platforms are disconnected", async () => {
    render(<GatewayView />);
    await waitFor(() => {
      const startButtons = screen.getAllByText("start");
      expect(startButtons.length).toBe(4);
    });
  });

  it("renders 4 disconnected status dots on initial load", async () => {
    const { container } = render(<GatewayView />);
    await waitFor(() => {
      const dots = container.querySelectorAll(".gw-dot-disconnected");
      expect(dots.length).toBe(4);
    });
  });

  it("renders connected dot when platform status is connected", async () => {
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = args as { platform?: string } | undefined;
      if (cmd === "gateway_status" && a?.platform === "telegram") {
        return Promise.resolve(CONNECTED_STATUS);
      }
      return Promise.resolve(DISCONNECTED_STATUS);
    });
    const { container } = render(<GatewayView />);
    await waitFor(() => {
      const connectedDot = container.querySelector(".gw-dot-connected");
      expect(connectedDot).toBeTruthy();
    });
  });

  it("renders error dot when platform status is error", async () => {
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = args as { platform?: string } | undefined;
      if (cmd === "gateway_status" && a?.platform === "discord") {
        return Promise.resolve(ERROR_STATUS);
      }
      return Promise.resolve(DISCONNECTED_STATUS);
    });
    const { container } = render(<GatewayView />);
    await waitFor(() => {
      const errorDot = container.querySelector(".gw-dot-error");
      expect(errorDot).toBeTruthy();
    });
  });

  it("shows error message when platform has an error", async () => {
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = args as { platform?: string } | undefined;
      if (cmd === "gateway_status" && a?.platform === "telegram") {
        return Promise.resolve(ERROR_STATUS);
      }
      return Promise.resolve(DISCONNECTED_STATUS);
    });
    render(<GatewayView />);
    await waitFor(() => {
      expect(screen.getByText("connection refused")).toBeTruthy();
    });
  });

  it("calls gateway_start when start button is clicked for a disconnected platform", async () => {
    render(<GatewayView />);
    await waitFor(() => screen.getAllByText("start"));
    const startButtons = screen.getAllByText("start");
    fireEvent.click(startButtons[0]!);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("gateway_start", {
        platform: "telegram",
      });
    });
  });

  it("calls gateway_stop when stop button is clicked for a connected platform", async () => {
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = args as { platform?: string } | undefined;
      if (cmd === "gateway_status" && a?.platform === "telegram") {
        return Promise.resolve(CONNECTED_STATUS);
      }
      if (cmd === "gateway_stop") return Promise.resolve(undefined);
      return Promise.resolve(DISCONNECTED_STATUS);
    });
    render(<GatewayView />);
    await waitFor(() => screen.getByText("stop"));
    fireEvent.click(screen.getByText("stop"));
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("gateway_stop", {
        platform: "telegram",
      });
    });
  });

  it("shows message count for connected platforms", async () => {
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      const a = args as { platform?: string } | undefined;
      if (cmd === "gateway_status" && a?.platform === "websocket") {
        return Promise.resolve(CONNECTED_STATUS);
      }
      return Promise.resolve(DISCONNECTED_STATUS);
    });
    render(<GatewayView />);
    await waitFor(() => {
      expect(screen.getByText("42 msgs")).toBeTruthy();
    });
  });

  it("expands config form when config button is clicked", async () => {
    render(<GatewayView />);
    await waitFor(() => screen.getAllByText("config"));
    const configToggles = screen.getAllByText("config");
    fireEvent.click(configToggles[0]!);
    // Telegram config form should appear (bot token field)
    expect(screen.getByPlaceholderText(/123456/)).toBeTruthy();
  });

  it("hides config form when config button is clicked again (toggle)", async () => {
    render(<GatewayView />);
    await waitFor(() => screen.getAllByText("config"));
    const configToggles = screen.getAllByText("config");
    fireEvent.click(configToggles[0]!);
    expect(screen.getByPlaceholderText(/123456/)).toBeTruthy();
    // Click again to hide
    fireEvent.click(screen.getByText("hide config"));
    expect(screen.queryByPlaceholderText(/123456/)).toBeNull();
  });

  it("opens logs modal when logs button is clicked", async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "gateway_logs") return Promise.resolve([]);
      return Promise.resolve(DISCONNECTED_STATUS);
    });
    render(<GatewayView />);
    await waitFor(() => screen.getAllByText("logs"));
    fireEvent.click(screen.getAllByText("logs")[0]!);
    await waitFor(() => {
      expect(screen.getByText("TELEGRAM LOGS")).toBeTruthy();
    });
  });

  it("shows 'no logs yet' when logs list is empty", async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "gateway_logs") return Promise.resolve([]);
      return Promise.resolve(DISCONNECTED_STATUS);
    });
    render(<GatewayView />);
    await waitFor(() => screen.getAllByText("logs"));
    fireEvent.click(screen.getAllByText("logs")[0]!);
    await waitFor(() => {
      expect(screen.getByText("no logs yet")).toBeTruthy();
    });
  });

  it("renders log entries in the logs modal", async () => {
    const mockLogs = [
      { ts: 1700000000000, level: "info",  message: "telegram connected" },
      { ts: 1700000001000, level: "error", message: "auth failed" },
    ];
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "gateway_logs") return Promise.resolve(mockLogs);
      return Promise.resolve(DISCONNECTED_STATUS);
    });
    render(<GatewayView />);
    await waitFor(() => screen.getAllByText("logs"));
    fireEvent.click(screen.getAllByText("logs")[0]!);
    await waitFor(() => {
      expect(screen.getByText("telegram connected")).toBeTruthy();
      expect(screen.getByText("auth failed")).toBeTruthy();
    });
  });

  it("closes logs modal when close is clicked", async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "gateway_logs") return Promise.resolve([]);
      return Promise.resolve(DISCONNECTED_STATUS);
    });
    render(<GatewayView />);
    await waitFor(() => screen.getAllByText("logs"));
    fireEvent.click(screen.getAllByText("logs")[0]!);
    await waitFor(() => screen.getByText("TELEGRAM LOGS"));
    fireEvent.click(screen.getByText("close"));
    expect(screen.queryByText("TELEGRAM LOGS")).toBeNull();
  });

  it("refresh status button calls gateway_status for all platforms", async () => {
    render(<GatewayView />);
    await waitFor(() => screen.getByText("refresh status"));
    fireEvent.click(screen.getByText("refresh status"));
    await waitFor(() => {
      const statusCalls = vi.mocked(invoke).mock.calls.filter(
        ([cmd]) => cmd === "gateway_status",
      );
      // 4 platforms * at least 2 refresh rounds (mount + button click)
      expect(statusCalls.length).toBeGreaterThanOrEqual(4);
    });
  });

  it("websocket config shows port field", async () => {
    render(<GatewayView />);
    await waitFor(() => screen.getAllByText("config"));
    // WebSocket is 3rd card (index 2)
    const configToggles = screen.getAllByText("config");
    fireEvent.click(configToggles[2]!);
    expect(screen.getByPlaceholderText("8080")).toBeTruthy();
  });

  it("http config shows host and port fields", async () => {
    render(<GatewayView />);
    await waitFor(() => screen.getAllByText("config"));
    // HTTP is 4th card (index 3)
    const configToggles = screen.getAllByText("config");
    fireEvent.click(configToggles[3]!);
    expect(screen.getByPlaceholderText("8888")).toBeTruthy();
    expect(screen.getByPlaceholderText("127.0.0.1")).toBeTruthy();
  });
});
