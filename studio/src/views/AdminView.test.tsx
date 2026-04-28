// AdminView tests — render each of the 6 tabs and verify core behaviors.
// Tauri invoke is mocked via src/__mocks__/@tauri-apps/api/core.ts (vi.fn()).
// plugin-fs is mocked via src/__mocks__/@tauri-apps/plugin-fs.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminView } from "./AdminView";
import * as fs from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

// ─── module mocks ────────────────────────────────────────────────────────────

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
      theme: "violet",
    },
    loading: false,
    save: vi.fn(),
    reload: vi.fn(),
  }),
}));

// ─── shared helpers ───────────────────────────────────────────────────────────

const EMPTY_CRED_RESULT = { columns: [], rows: [] };
const MOCK_CRED_RESULT = {
  columns: ["id", "provider", "label", "enabled", "rate_limited_until", "last_used_at", "created_at"],
  rows: [
    ["cred_abc123", "openai", "work", 1, null, 1700000000000, 1699000000000],
    ["cred_def456", "anthropic", null, 0, null, null, 1699100000000],
  ],
};

function seedEmptyCreds() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
    return undefined;
  });
}

function seedMockCreds() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "credentials_db_query") return MOCK_CRED_RESULT;
    return undefined;
  });
}

function clickTab(label: string) {
  fireEvent.click(screen.getByText(label));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.exists).mockResolvedValue(false);
  vi.mocked(fs.readTextFile).mockResolvedValue("{}");
  vi.mocked(fs.writeTextFile).mockResolvedValue(undefined);
  vi.mocked(fs.readDir).mockResolvedValue([]);
  vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  vi.mocked(fs.remove).mockResolvedValue(undefined);
  seedEmptyCreds();
});

// ─────────────────────────────────────────────────────────────────────────────
// AdminView shell
// ─────────────────────────────────────────────────────────────────────────────

describe("AdminView shell", () => {
  it("renders all 6 tab buttons", () => {
    render(<AdminView />);
    const expectedTabs = ["credentials", "doctor", "update", "config", "tools", "personality"];
    for (const tab of expectedTabs) {
      expect(screen.getByRole("button", { name: tab })).toBeTruthy();
    }
  });

  it("shows credentials tab by default", () => {
    render(<AdminView />);
    expect(screen.getByText(/add credential/i)).toBeTruthy();
  });

  it("switches to doctor tab on click", () => {
    render(<AdminView />);
    clickTab("doctor");
    // Doctor tab has a unique "run health check" button (credentials tab doesn't)
    expect(screen.getAllByText("run health check").length).toBeGreaterThan(0);
  });

  it("switches to update tab on click", () => {
    render(<AdminView />);
    clickTab("update");
    expect(screen.getAllByText("check for updates").length).toBeGreaterThan(0);
  });

  it("switches to config tab on click", () => {
    render(<AdminView />);
    clickTab("config");
    expect(screen.getAllByText("save changes").length).toBeGreaterThan(0);
  });

  it("switches to tools tab on click", () => {
    render(<AdminView />);
    clickTab("tools");
    // Tools tab shows preset buttons as a distinctive element
    expect(screen.getByRole("button", { name: "minimal" })).toBeTruthy();
  });

  it("switches to personality tab on click", () => {
    render(<AdminView />);
    clickTab("personality");
    expect(screen.getByText("+ new")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: Credentials
// ─────────────────────────────────────────────────────────────────────────────

describe("CredentialsTab", () => {
  it("shows empty state when no credentials exist", async () => {
    render(<AdminView />);
    await waitFor(() => {
      expect(screen.getByText(/no credentials yet/)).toBeTruthy();
    });
  });

  it("renders credentials from db query", async () => {
    seedMockCreds();
    render(<AdminView />);
    await waitFor(() => {
      expect(screen.getByText(/openai/)).toBeTruthy();
      expect(screen.getByText(/anthropic/)).toBeTruthy();
    });
  });

  it("shows 'work' label for first credential", async () => {
    seedMockCreds();
    render(<AdminView />);
    await waitFor(() => {
      expect(screen.getByText("work")).toBeTruthy();
    });
  });

  it("opens add modal when '+ add credential' is clicked", async () => {
    render(<AdminView />);
    await waitFor(() => screen.getByText("+ add credential"));
    fireEvent.click(screen.getByText("+ add credential"));
    expect(screen.getByText("ADD CREDENTIAL")).toBeTruthy();
  });

  it("shows validation error when API key is empty", async () => {
    render(<AdminView />);
    await waitFor(() => screen.getByText("+ add credential"));
    fireEvent.click(screen.getByText("+ add credential"));
    fireEvent.click(screen.getByText("add credential"));
    expect(screen.getByText("API key is required")).toBeTruthy();
  });

  it("calls cero_cli credentials add on valid form submit", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return MOCK_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: "added cred_xyz\n", stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    await waitFor(() => screen.getByText("+ add credential"));
    fireEvent.click(screen.getByText("+ add credential"));
    const passwordInput = screen.getByPlaceholderText("sk-...");
    fireEvent.change(passwordInput, { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByText("add credential"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cero_cli", expect.objectContaining({
        args: expect.arrayContaining(["credentials", "add"]),
      }));
    });
  });

  it("calls cero_cli credentials remove on rm click with confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return MOCK_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: "removed\n", stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    await waitFor(() => screen.getAllByText("rm"));
    const rmButtons = screen.getAllByText("rm");
    fireEvent.click(rmButtons[0]!);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cero_cli", expect.objectContaining({
        args: expect.arrayContaining(["credentials", "remove"]),
      }));
    });
    confirmSpy.mockRestore();
  });

  it("does NOT call remove when confirm is declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    seedMockCreds();
    render(<AdminView />);
    await waitFor(() => screen.getAllByText("rm"));
    const rmButtons = screen.getAllByText("rm");
    fireEvent.click(rmButtons[0]!);
    expect(invoke).not.toHaveBeenCalledWith("cero_cli", expect.objectContaining({
      args: expect.arrayContaining(["remove"]),
    }));
    confirmSpy.mockRestore();
  });

  it("calls peek when peek button is clicked", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return MOCK_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: "cred_abc123  sk-*...key  work\n", stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    await waitFor(() => screen.getAllByText("peek"));
    fireEvent.click(screen.getAllByText("peek")[0]!);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cero_cli", expect.objectContaining({
        args: expect.arrayContaining(["credentials", "peek"]),
      }));
    });
    alertSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: Doctor
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_DOCTOR_OUTPUT = `[ok]   cero home dir               /home/user/.cero
[ok]   provider:anthropic          env ANTHROPIC_API_KEY
[warn] provider:openai             not configured (OPENAI_API_KEY unset, no pool entries)
[ok]   sandbox:docker              docker daemon 24.0.5
[ok]   disk space                  45.20 GB free at /home/user/.cero
[ok]   cero version                0.4.2
`;

describe("DoctorTab", () => {
  it("shows run button in idle state", () => {
    render(<AdminView />);
    clickTab("doctor");
    expect(screen.getByText("run health check")).toBeTruthy();
  });

  it("calls cero_cli doctor on run click", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: MOCK_DOCTOR_OUTPUT, stderr: "", exit_code: 2 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("doctor");
    fireEvent.click(screen.getByText("run health check"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cero_cli", { args: ["doctor"] });
    });
  });

  it("renders parsed check results after running", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: MOCK_DOCTOR_OUTPUT, stderr: "", exit_code: 2 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("doctor");
    fireEvent.click(screen.getByText("run health check"));
    await waitFor(() => {
      expect(screen.getByText("cero home dir")).toBeTruthy();
      expect(screen.getByText("provider:anthropic")).toBeTruthy();
      expect(screen.getByText("provider:openai")).toBeTruthy();
    });
  });

  it("shows warn count when there are warnings", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: MOCK_DOCTOR_OUTPUT, stderr: "", exit_code: 2 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("doctor");
    fireEvent.click(screen.getByText("run health check"));
    await waitFor(() => {
      expect(screen.getByText(/1 warn/)).toBeTruthy();
    });
  });

  it("expands remediation hint when warning row is clicked", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: MOCK_DOCTOR_OUTPUT, stderr: "", exit_code: 2 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("doctor");
    fireEvent.click(screen.getByText("run health check"));
    await waitFor(() => screen.getByText("provider:openai"));
    fireEvent.click(screen.getByText("provider:openai"));
    await waitFor(() => {
      expect(screen.getByText(/Set OPENAI_API_KEY/)).toBeTruthy();
    });
  });

  it("shows re-run button after first run", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: MOCK_DOCTOR_OUTPUT, stderr: "", exit_code: 2 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("doctor");
    fireEvent.click(screen.getByText("run health check"));
    await waitFor(() => screen.getByText("re-run"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab 3: Update
// ─────────────────────────────────────────────────────────────────────────────

const UPDATE_UP_TO_DATE = `current: 0.4.2\nlatest : 0.4.2\nup to date\n`;
const UPDATE_NEWER = `current: 0.4.2\nlatest : 0.5.0\nasset  : https://github.com/GonzaloRocca/cero/releases/download/v0.5.0/cero-windows.exe (5.2 MB)\n---\n- New feature A\n- Bug fix B\n---\nrun \`cero update --apply\` to install 0.5.0.\n`;

describe("UpdateTab", () => {
  it("shows check button in idle state", () => {
    render(<AdminView />);
    clickTab("update");
    expect(screen.getByText("check for updates")).toBeTruthy();
  });

  it("calls cero_cli update on check click", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: UPDATE_UP_TO_DATE, stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("update");
    fireEvent.click(screen.getByText("check for updates"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cero_cli", { args: ["update"] });
    });
  });

  it("shows 'Up to date' when current === latest", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: UPDATE_UP_TO_DATE, stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("update");
    fireEvent.click(screen.getByText("check for updates"));
    await waitFor(() => {
      expect(screen.getByText("Up to date")).toBeTruthy();
    });
  });

  it("shows install button when newer version available", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: UPDATE_NEWER, stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("update");
    fireEvent.click(screen.getByText("check for updates"));
    await waitFor(() => {
      expect(screen.getByText(/download & install 0.5.0/)).toBeTruthy();
    });
  });

  it("shows release notes when present", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: UPDATE_NEWER, stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("update");
    fireEvent.click(screen.getByText("check for updates"));
    await waitFor(() => {
      expect(screen.getByText("RELEASE NOTES")).toBeTruthy();
      expect(screen.getByText(/New feature A/)).toBeTruthy();
    });
  });

  it("calls cero_cli update --apply when install is clicked", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") {
        const a = (args as { args: string[] }).args;
        if (a.includes("--apply")) return { stdout: "installed cero 0.5.0.\n", stderr: "", exit_code: 0 };
        return { stdout: UPDATE_NEWER, stderr: "", exit_code: 0 };
      }
      return undefined;
    });
    render(<AdminView />);
    clickTab("update");
    fireEvent.click(screen.getByText("check for updates"));
    await waitFor(() => screen.getByText(/download & install 0.5.0/));
    fireEvent.click(screen.getByText(/download & install 0.5.0/));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cero_cli", { args: ["update", "--apply"] });
    });
  });

  it("shows restart button after successful apply", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") {
        const a = (args as { args: string[] }).args;
        if (a.includes("--apply")) return { stdout: "installed cero 0.5.0.\n", stderr: "", exit_code: 0 };
        return { stdout: UPDATE_NEWER, stderr: "", exit_code: 0 };
      }
      return undefined;
    });
    render(<AdminView />);
    clickTab("update");
    fireEvent.click(screen.getByText("check for updates"));
    await waitFor(() => screen.getByText(/download & install 0.5.0/));
    fireEvent.click(screen.getByText(/download & install 0.5.0/));
    await waitFor(() => {
      expect(screen.getByText("restart now")).toBeTruthy();
    });
  });

  it("passes --repo flag when custom repo is set", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: UPDATE_UP_TO_DATE, stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("update");
    const repoInput = screen.getByPlaceholderText("owner/name (optional)");
    fireEvent.change(repoInput, { target: { value: "myorg/myrepo" } });
    fireEvent.click(screen.getByText("check for updates"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cero_cli", { args: ["update", "--repo", "myorg/myrepo"] });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab 4: Config
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_CONFIG_JSON = JSON.stringify({
  provider: { default: "anthropic" },
  sandbox: { default: "local" },
  mcpServers: { filesystem: { command: "npx", args: [] } },
}, null, 2);

describe("ConfigTab", () => {
  it("shows empty state when config file not found", async () => {
    vi.mocked(fs.exists).mockResolvedValue(false);
    render(<AdminView />);
    clickTab("config");
    await waitFor(() => {
      expect(screen.getByText(/config file not found/)).toBeTruthy();
    });
  });

  it("renders config tree when file exists", async () => {
    vi.mocked(fs.exists).mockResolvedValue(true);
    vi.mocked(fs.readTextFile).mockResolvedValue(MOCK_CONFIG_JSON);
    render(<AdminView />);
    clickTab("config");
    await waitFor(() => {
      expect(screen.getByText("provider.default")).toBeTruthy();
      expect(screen.getByText("sandbox.default")).toBeTruthy();
    });
  });

  it("calls writeTextFile when save changes is clicked", async () => {
    vi.mocked(fs.exists).mockResolvedValue(true);
    vi.mocked(fs.readTextFile).mockResolvedValue(MOCK_CONFIG_JSON);
    render(<AdminView />);
    clickTab("config");
    await waitFor(() => screen.getByText("provider.default"));
    fireEvent.click(screen.getByText("save changes"));
    await waitFor(() => {
      expect(fs.writeTextFile).toHaveBeenCalled();
    });
  });

  it("shows restart prompt after save", async () => {
    vi.mocked(fs.exists).mockResolvedValue(true);
    vi.mocked(fs.readTextFile).mockResolvedValue(MOCK_CONFIG_JSON);
    render(<AdminView />);
    clickTab("config");
    await waitFor(() => screen.getByText("save changes"));
    fireEvent.click(screen.getByText("save changes"));
    await waitFor(() => {
      expect(screen.getByText("APPLY CHANGES")).toBeTruthy();
    });
  });

  it("marks rows as modified when values change", async () => {
    vi.mocked(fs.exists).mockResolvedValue(true);
    vi.mocked(fs.readTextFile).mockResolvedValue(MOCK_CONFIG_JSON);
    render(<AdminView />);
    clickTab("config");
    await waitFor(() => screen.getByText("provider.default"));
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    if (inputs[0]) {
      fireEvent.change(inputs[0], { target: { value: "openai" } });
    }
    await waitFor(() => {
      expect(screen.getByText(/1 modified/)).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab 5: Tools
// ─────────────────────────────────────────────────────────────────────────────

describe("ToolsTab", () => {
  it("shows tool list from KNOWN_TOOLS", async () => {
    render(<AdminView />);
    clickTab("tools");
    await waitFor(() => {
      expect(screen.getByText("read_file")).toBeTruthy();
      expect(screen.getByText("write_file")).toBeTruthy();
      expect(screen.getByText("run_shell")).toBeTruthy();
    });
  });

  it("shows all tools as enabled when no toggles file exists", async () => {
    vi.mocked(fs.exists).mockResolvedValue(false);
    render(<AdminView />);
    clickTab("tools");
    await waitFor(() => {
      const enabledButtons = screen.getAllByText("enabled");
      expect(enabledButtons.length).toBeGreaterThan(0);
    });
  });

  it("calls cero_cli tools disable on toggle click", async () => {
    vi.mocked(fs.exists).mockResolvedValue(false);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: "disabled read_file\n", stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("tools");
    await waitFor(() => screen.getAllByText("enabled"));
    const toggleBtns = screen.getAllByText("enabled");
    fireEvent.click(toggleBtns[0]!);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cero_cli", expect.objectContaining({
        args: expect.arrayContaining(["tools", "disable"]),
      }));
    });
  });

  it("calls cero_cli tools toggle-set when preset is clicked", async () => {
    vi.mocked(fs.exists).mockResolvedValue(false);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "credentials_db_query") return EMPTY_CRED_RESULT;
      if (cmd === "cero_cli") return { stdout: "preset → minimal\n", stderr: "", exit_code: 0 };
      return undefined;
    });
    render(<AdminView />);
    clickTab("tools");
    await waitFor(() => screen.getByRole("button", { name: "minimal" }));
    fireEvent.click(screen.getByRole("button", { name: "minimal" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cero_cli", {
        args: ["tools", "toggle-set", "minimal"],
      });
    });
  });

  it("filters tools by search input", async () => {
    render(<AdminView />);
    clickTab("tools");
    await waitFor(() => screen.getByText("read_file"));
    const searchInput = screen.getByPlaceholderText("filter tools…");
    fireEvent.change(searchInput, { target: { value: "shell" } });
    await waitFor(() => {
      expect(screen.getByText("run_shell")).toBeTruthy();
      expect(screen.queryByText("read_file")).toBeNull();
    });
  });

  it("shows no match message when filter matches nothing", async () => {
    render(<AdminView />);
    clickTab("tools");
    await waitFor(() => screen.getByText("read_file"));
    const searchInput = screen.getByPlaceholderText("filter tools…");
    fireEvent.change(searchInput, { target: { value: "xyznonexistent" } });
    await waitFor(() => {
      expect(screen.getByText(/no tools match/)).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tab 6: Personality
// ─────────────────────────────────────────────────────────────────────────────

describe("PersonalityTab", () => {
  function seedPersonalities() {
    vi.mocked(fs.exists).mockResolvedValue(true);
    vi.mocked(fs.readDir).mockResolvedValue([
      { name: "concise.md", isDirectory: false, isFile: true, isSymlink: false } as ReturnType<typeof vi.mocked<typeof fs.readDir>> extends Promise<infer U> ? U[number] : never,
      { name: "verbose.md", isDirectory: false, isFile: true, isSymlink: false } as ReturnType<typeof vi.mocked<typeof fs.readDir>> extends Promise<infer U> ? U[number] : never,
    ] as Awaited<ReturnType<typeof fs.readDir>>);
    vi.mocked(fs.readTextFile).mockImplementation(async (path: string | URL) => {
      const p = String(path);
      if (p.includes("active-personality")) return "concise";
      if (p.includes("concise")) return "Short answers.\n";
      if (p.includes("verbose")) return "Long answers with rationale.\n";
      return "";
    });
  }

  it("shows '+ new' button", async () => {
    render(<AdminView />);
    clickTab("personality");
    await waitFor(() => {
      expect(screen.getByText("+ new")).toBeTruthy();
    });
  });

  it("renders personality list when files exist", async () => {
    seedPersonalities();
    render(<AdminView />);
    clickTab("personality");
    await waitFor(() => {
      // "concise" appears in toolbar (active name) + row title; at least one element should be in a .dv-row-title
      expect(screen.getAllByText("concise").length).toBeGreaterThan(0);
      expect(screen.getAllByText("verbose").length).toBeGreaterThan(0);
    });
  });

  it("shows active checkmark for active personality", async () => {
    seedPersonalities();
    render(<AdminView />);
    clickTab("personality");
    await waitFor(() => screen.getAllByText("concise"));
    // The active personality row title contains "✓"
    // Use getAllByText since "concise" appears in the toolbar too
    const conciseEls = screen.getAllByText("concise");
    const rowTitle = conciseEls.find((el) => el.closest(".dv-row-title"));
    const activeRow = rowTitle?.closest(".dv-row");
    expect(activeRow?.textContent).toContain("✓");
  });

  it("opens new personality modal", async () => {
    render(<AdminView />);
    clickTab("personality");
    await waitFor(() => screen.getByText("+ new"));
    fireEvent.click(screen.getByText("+ new"));
    expect(screen.getByText("NEW PERSONALITY")).toBeTruthy();
  });

  it("shows validation error when name is empty in new modal", async () => {
    render(<AdminView />);
    clickTab("personality");
    await waitFor(() => screen.getByText("+ new"));
    fireEvent.click(screen.getByText("+ new"));
    fireEvent.click(screen.getByText("create"));
    expect(screen.getByText("name is required")).toBeTruthy();
  });

  it("shows validation error for reserved 'default' name", async () => {
    render(<AdminView />);
    clickTab("personality");
    await waitFor(() => screen.getByText("+ new"));
    fireEvent.click(screen.getByText("+ new"));
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(inputs[0]!, { target: { value: "default" } });
    fireEvent.click(screen.getByText("create"));
    expect(screen.getByText(/"default" is reserved/)).toBeTruthy();
  });

  it("calls writeTextFile when a new personality is saved", async () => {
    render(<AdminView />);
    clickTab("personality");
    await waitFor(() => screen.getByText("+ new"));
    fireEvent.click(screen.getByText("+ new"));
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(inputs[0]!, { target: { value: "pirate" } });
    const textareas = screen.getAllByRole("textbox") as HTMLInputElement[];
    // The textarea for content is the second textbox
    fireEvent.change(textareas[1]!, { target: { value: "Arrr, speak like a pirate." } });
    fireEvent.click(screen.getByText("create"));
    await waitFor(() => {
      expect(fs.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining("pirate.md"),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  it("calls set-active when 'set active' button is clicked", async () => {
    seedPersonalities();
    render(<AdminView />);
    clickTab("personality");
    await waitFor(() => screen.getAllByText("set active"));
    const setActiveBtn = screen.getAllByText("set active")[0]!;
    fireEvent.click(setActiveBtn);
    await waitFor(() => {
      expect(fs.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining("active-personality.txt"),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  it("calls remove when delete button is clicked with confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    // verbose is not builtin in the mocked data (we mock readDir directly)
    // So we need a custom personality that shows the delete button
    vi.mocked(fs.exists).mockResolvedValue(true);
    vi.mocked(fs.readDir).mockResolvedValue([
      { name: "custom.md", isDirectory: false, isFile: true, isSymlink: false } as Awaited<ReturnType<typeof fs.readDir>>[number],
    ] as Awaited<ReturnType<typeof fs.readDir>>);
    vi.mocked(fs.readTextFile).mockImplementation(async (path: string | URL) => {
      const p = String(path);
      if (p.includes("active-personality")) return "default";
      return "Custom content.\n";
    });
    render(<AdminView />);
    clickTab("personality");
    await waitFor(() => screen.getByText("delete"));
    fireEvent.click(screen.getByText("delete"));
    await waitFor(() => {
      expect(fs.remove).toHaveBeenCalledWith(
        expect.stringContaining("custom.md"),
        expect.any(Object),
      );
    });
    confirmSpy.mockRestore();
  });
});
