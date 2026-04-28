import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StatsView } from "./StatsView";
import type { StatsData } from "../hooks/useStatsData";

// ─── mock useStatsData ───────────────────────────────────────────────────────

const mockRefresh = vi.fn().mockResolvedValue(undefined);
let MOCK_DATA: StatsData;
let MOCK_LOADING = false;
let MOCK_ERROR: string | null = null;

vi.mock("../hooks/useStatsData", () => ({
  useStatsData: () => ({
    data: MOCK_DATA,
    loading: MOCK_LOADING,
    error: MOCK_ERROR,
    refresh: mockRefresh,
  }),
}));

// recharts tries to measure DOM nodes; stub ResizeObserver used internally
global.ResizeObserver = class {
  observe(): void { /* noop */ }
  unobserve(): void { /* noop */ }
  disconnect(): void { /* noop */ }
};

// ─── fixtures ────────────────────────────────────────────────────────────────

const EMPTY_STATS: StatsData = {
  daily: [],
  models: [],
  skills: [],
  cron: { total: 0, enabled: 0, ok_runs: 0, error_runs: 0 },
  totalSessions: 0,
  skillCount: 0,
  lessonCount: 0,
  totalCostUsd: 0,
  totalTokens: 0,
};

const FULL_STATS: StatsData = {
  daily: [
    { date: "2025-04-01", input_tokens: 12000, output_tokens: 3000, cost_usd: 0.015, turns: 5 },
    { date: "2025-04-02", input_tokens: 8000,  output_tokens: 2000, cost_usd: 0.01,  turns: 3 },
    { date: "2025-04-03", input_tokens: 20000, output_tokens: 5000, cost_usd: 0.025, turns: 8 },
  ],
  models: [
    { model: "claude-3-5-sonnet", total_tokens: 35000, cost_usd: 0.04, turns: 12 },
    { model: "gpt-4o",            total_tokens: 8000,  cost_usd: 0.01, turns:  4 },
  ],
  skills: [
    { name: "git-summary",    applied: 15, success_rate: 93.3 },
    { name: "slack-post",     applied: 8,  success_rate: 100  },
    { name: "search-web",     applied: 5,  success_rate: 80   },
  ],
  cron: { total: 5, enabled: 3, ok_runs: 42, error_runs: 3 },
  totalSessions: 24,
  skillCount: 12,
  lessonCount: 37,
  totalCostUsd: 0.05,
  totalTokens: 50000,
};

beforeEach(() => {
  MOCK_DATA = EMPTY_STATS;
  MOCK_LOADING = false;
  MOCK_ERROR = null;
  mockRefresh.mockClear();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("StatsView", () => {

  describe("render — empty state", () => {
    it("renders STATS heading", () => {
      render(<StatsView />);
      expect(screen.getByText("STATS")).toBeTruthy();
    });

    it("renders refresh button", () => {
      render(<StatsView />);
      expect(screen.getByText("refresh")).toBeTruthy();
    });

    it("shows no usage data message when all arrays are empty", () => {
      render(<StatsView />);
      expect(screen.getByText(/no usage data found/i)).toBeTruthy();
    });

    it("shows zero stat cards", () => {
      render(<StatsView />);
      const sessionCard = screen.getByText("sessions");
      expect(sessionCard).toBeTruthy();
    });
  });

  describe("render — loading state", () => {
    it("shows loading indicator", () => {
      MOCK_LOADING = true;
      render(<StatsView />);
      expect(screen.getByText("loading…")).toBeTruthy();
    });

    it("does not show stat grid while loading", () => {
      MOCK_LOADING = true;
      render(<StatsView />);
      expect(screen.queryByText("sessions")).toBeNull();
    });
  });

  describe("render — error state", () => {
    it("shows error message", () => {
      MOCK_ERROR = "open usage.db: file not found";
      render(<StatsView />);
      expect(screen.getByText(/stats unavailable/)).toBeTruthy();
      expect(screen.getByText(/file not found/)).toBeTruthy();
    });
  });

  describe("render — full data", () => {
    beforeEach(() => {
      MOCK_DATA = FULL_STATS;
    });

    it("shows total sessions", () => {
      render(<StatsView />);
      expect(screen.getByText("24")).toBeTruthy();
    });

    it("shows skill count", () => {
      render(<StatsView />);
      expect(screen.getByText("12")).toBeTruthy();
    });

    it("shows lesson count", () => {
      render(<StatsView />);
      expect(screen.getByText("37")).toBeTruthy();
    });

    it("shows cron jobs enabled/total", () => {
      render(<StatsView />);
      expect(screen.getByText("3/5")).toBeTruthy();
    });

    it("shows cron success percentage", () => {
      render(<StatsView />);
      // 42/(42+3) = 93%
      expect(screen.getByText("93%")).toBeTruthy();
    });

    it("shows total token count formatted", () => {
      render(<StatsView />);
      expect(screen.getByText("50.0K")).toBeTruthy();
    });

    it("shows total cost formatted", () => {
      render(<StatsView />);
      expect(screen.getByText("$0.05")).toBeTruthy();
    });

    it("renders tokens/day chart title", () => {
      render(<StatsView />);
      expect(screen.getByText("tokens / day (30d)")).toBeTruthy();
    });

    it("renders cost chart title when costs are non-zero", () => {
      render(<StatsView />);
      expect(screen.getByText("cost USD / day")).toBeTruthy();
    });

    it("renders models chart title", () => {
      render(<StatsView />);
      expect(screen.getByText("tokens by model")).toBeTruthy();
    });

    it("renders skills chart title", () => {
      render(<StatsView />);
      expect(screen.getByText("top skills")).toBeTruthy();
    });

    it("does NOT show no-data message when data exists", () => {
      render(<StatsView />);
      expect(screen.queryByText(/no usage data found/)).toBeNull();
    });
  });

  describe("interactions", () => {
    it("calls refresh when refresh button clicked", async () => {
      render(<StatsView />);
      fireEvent.click(screen.getByText("refresh"));
      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      });
    });
  });
});
