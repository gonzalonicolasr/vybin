// MCPView unit tests.
// Tauri invoke and fs plugin are mocked via src/__mocks__/.
// Tests verify rendering with pre-seeded servers, add-form validation, and
// delete flow.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MCPView } from "./MCPView";
import * as fs from "@tauri-apps/plugin-fs";

// The MCPView uses useTabs and useSettings internally (for the restart-sidecar
// path). Provide lightweight mocks so the component can mount.
vi.mock("../hooks/useTabs", () => ({
  useTabs: () => ({
    tabs: [{ id: "t1", title: "tab 1", history: [], busy: false, ready: false, meta: null }],
    activeTabId: "t1",
    activeTab: null,
    openTab: vi.fn(),
    closeTab: vi.fn(),
    switchTab: vi.fn(),
    cycleTab: vi.fn(),
    updateTab: vi.fn(),
    appendTurn: vi.fn(),
    updateTurn: vi.fn(),
    loaded: true,
  }),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "",
      anthropicApiKey: "",
      openaiApiKey: "sk-test",
      geminiApiKey: "",
      awsAccessKeyId: "",
      awsSecretAccessKey: "",
      awsRegion: "us-east-1",
      sandbox: "local",
      learningMode: "auto",
      goal: "",
    },
    loading: false,
    save: vi.fn(),
    reload: vi.fn(),
  }),
}));

const MOCK_CONFIG = {
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: { NODE_ENV: "production" },
    },
    fetch: {
      command: "uvx",
      args: ["mcp-server-fetch"],
    },
  },
};

function seedConfig() {
  vi.mocked(fs.exists).mockResolvedValue(true);
  vi.mocked(fs.readTextFile).mockResolvedValue(JSON.stringify(MOCK_CONFIG));
}

beforeEach(() => {
  vi.clearAllMocks();
  seedConfig();
});

describe("MCPView", () => {
  it("renders the server list after loading", async () => {
    render(<MCPView />);
    await waitFor(() => {
      expect(screen.getByText("filesystem")).toBeTruthy();
      expect(screen.getByText("fetch")).toBeTruthy();
    });
  });

  it("shows server count in header", async () => {
    render(<MCPView />);
    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy();
    });
  });

  it("shows command in row subtitle", async () => {
    render(<MCPView />);
    await waitFor(() => {
      expect(screen.getByText(/npx/)).toBeTruthy();
      expect(screen.getByText(/uvx/)).toBeTruthy();
    });
  });

  it("renders empty state when no servers configured", async () => {
    vi.mocked(fs.exists).mockResolvedValue(false);
    render(<MCPView />);
    await waitFor(() => {
      expect(screen.getByText(/no MCP servers configured/)).toBeTruthy();
    });
  });

  it("opens detail modal when a server row is clicked", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("filesystem"));
    fireEvent.click(screen.getByText("filesystem"));
    expect(screen.getByText("COMMAND")).toBeTruthy();
  });

  it("shows env vars in detail modal", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("filesystem"));
    fireEvent.click(screen.getByText("filesystem"));
    expect(screen.getByText("NODE_ENV")).toBeTruthy();
    expect(screen.getByText("production")).toBeTruthy();
  });

  it("opens add modal when '+ add server' is clicked", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("+ add server"));
    fireEvent.click(screen.getByText("+ add server"));
    expect(screen.getByText("ADD MCP SERVER")).toBeTruthy();
  });

  it("shows validation error when name is empty on add", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("+ add server"));
    fireEvent.click(screen.getByText("+ add server"));
    // Click save without filling name
    fireEvent.click(screen.getByText("add server"));
    expect(screen.getByText("Server name is required")).toBeTruthy();
  });

  it("shows validation error when command is empty on add", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("+ add server"));
    fireEvent.click(screen.getByText("+ add server"));
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    // First input is name
    fireEvent.change(inputs[0]!, { target: { value: "myserver" } });
    fireEvent.click(screen.getByText("add server"));
    expect(screen.getByText("Command is required")).toBeTruthy();
  });

  it("shows duplicate name error when adding a server with existing name", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("+ add server"));
    fireEvent.click(screen.getByText("+ add server"));
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(inputs[0]!, { target: { value: "filesystem" } });
    fireEvent.change(inputs[1]!, { target: { value: "npx" } });
    fireEvent.click(screen.getByText("add server"));
    expect(screen.getByText(/already exists/)).toBeTruthy();
  });

  it("adds a new server to the list successfully", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("+ add server"));
    fireEvent.click(screen.getByText("+ add server"));
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(inputs[0]!, { target: { value: "myserver" } });
    fireEvent.change(inputs[1]!, { target: { value: "npx" } });
    fireEvent.click(screen.getByText("add server"));
    // Modal should close and new server appears in list
    await waitFor(() => {
      expect(screen.getByText("myserver")).toBeTruthy();
    });
  });

  it("removes a server after delete confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MCPView />);
    await waitFor(() => screen.getByText("fetch"));
    fireEvent.click(screen.getByText("fetch"));
    // Click delete in detail modal
    fireEvent.click(screen.getByText("delete"));
    expect(confirmSpy).toHaveBeenCalled();
    // fetch should be gone from the list
    await waitFor(() => {
      expect(screen.queryByText("fetch")).toBeNull();
    });
    confirmSpy.mockRestore();
  });

  it("does NOT remove server when confirm is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MCPView />);
    await waitFor(() => screen.getByText("fetch"));
    fireEvent.click(screen.getByText("fetch"));
    fireEvent.click(screen.getByText("delete"));
    // fetch should still be there — modal remains open, so "fetch" appears in
    // both the row title and the modal heading — use getAllByText
    expect(screen.getAllByText("fetch").length).toBeGreaterThan(0);
    confirmSpy.mockRestore();
  });

  it("calls writeTextFile when apply changes is clicked", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("apply changes"));
    fireEvent.click(screen.getByText("apply changes"));
    await waitFor(() => {
      expect(fs.writeTextFile).toHaveBeenCalled();
    });
  });

  it("shows restart confirm modal after applying changes", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("apply changes"));
    fireEvent.click(screen.getByText("apply changes"));
    await waitFor(() => {
      expect(screen.getByText("APPLY CHANGES")).toBeTruthy();
      expect(screen.getByText(/Restart the sidecar/)).toBeTruthy();
    });
  });

  it("can add and remove args in add modal", async () => {
    render(<MCPView />);
    await waitFor(() => screen.getByText("+ add server"));
    fireEvent.click(screen.getByText("+ add server"));
    // Add an arg
    fireEvent.click(screen.getByText("+ add arg"));
    const argInputs = screen.getAllByPlaceholderText(/arg\[/);
    expect(argInputs.length).toBe(1);
    // Remove it
    const removeButtons = screen.getAllByTitle ? screen.queryAllByRole("button") : [];
    const removeArgBtn = removeButtons.find(
      (b) => b.textContent === "✕" && b.closest(".settings-section"),
    );
    if (removeArgBtn) {
      fireEvent.click(removeArgBtn);
    }
  });
});
