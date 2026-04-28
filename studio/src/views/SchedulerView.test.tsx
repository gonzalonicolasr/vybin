import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SchedulerView } from "./SchedulerView";
import type { CronJob } from "../hooks/useCronData";

// ─── mock useCronData ────────────────────────────────────────────────────────

const mockRefresh = vi.fn().mockResolvedValue(undefined);
const mockCronAction = vi.fn().mockResolvedValue({ ok: true });
const mockQueryOutputs = vi.fn().mockResolvedValue([]);

vi.mock("../hooks/useCronData", () => ({
  useCronJobs: () => ({
    jobs: MOCK_JOBS,
    loading: false,
    error: null,
    refresh: mockRefresh,
  }),
  cronAction: (...args: unknown[]) => mockCronAction(...args),
  queryOutputs: (...args: unknown[]) => mockQueryOutputs(...args),
}));

// ─── mock Markdown ───────────────────────────────────────────────────────────

vi.mock("../Markdown", () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-1",
    name: "daily-standup",
    prompt: "Summarise yesterday's git log",
    schedule_kind: "cron",
    schedule_expr: "0 9 * * 1-5",
    schedule_minutes: null,
    schedule_run_at: null,
    schedule_display: "0 9 * * 1-5",
    skills: ["git-summary"],
    script: null,
    workdir: "/home/gonza/project",
    model: "claude-3-5-sonnet",
    provider: "anthropic",
    deliver: "telegram",
    repeat_times: null,
    repeat_completed: 7,
    enabled: true,
    state: "scheduled",
    paused_at: null,
    paused_reason: null,
    next_run_at: Date.now() + 3_600_000,
    last_run_at: Date.now() - 86_400_000,
    last_status: "ok",
    last_error: null,
    created_at: Date.now() - 7 * 86_400_000,
    updated_at: Date.now() - 86_400_000,
    ...overrides,
  };
}

let MOCK_JOBS: CronJob[] = [];

beforeEach(() => {
  MOCK_JOBS = [
    makeJob(),
    makeJob({
      id: "job-2",
      name: "error-check",
      prompt: "Check for new errors in prod logs",
      state: "error",
      last_status: "error",
      last_error: "API timeout",
      deliver: "local",
      enabled: true,
    }),
    makeJob({
      id: "job-3",
      name: "weekly-report",
      prompt: "Generate weekly performance report",
      state: "paused",
      enabled: false,
    }),
  ];
  mockRefresh.mockClear();
  mockCronAction.mockClear();
  mockQueryOutputs.mockClear().mockResolvedValue([]);
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("SchedulerView", () => {

  describe("render", () => {
    it("renders SCHEDULER heading with job count", () => {
      render(<SchedulerView />);
      expect(screen.getByText(/SCHEDULER/)).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
    });

    it("renders all job names", () => {
      render(<SchedulerView />);
      expect(screen.getByText("daily-standup")).toBeTruthy();
      expect(screen.getByText("error-check")).toBeTruthy();
      expect(screen.getByText("weekly-report")).toBeTruthy();
    });

    it("shows schedule display for each job", () => {
      render(<SchedulerView />);
      expect(screen.getAllByText("0 9 * * 1-5").length).toBeGreaterThan(0);
    });

    it("shows disabled pill for disabled jobs", () => {
      render(<SchedulerView />);
      // "disabled" appears both as a filter button and as a row pill
      expect(screen.getAllByText("disabled").length).toBeGreaterThan(0);
      // Specifically, the dv-pill-dim span for the disabled job row
      const pill = document.querySelector(".dv-pill.dv-pill-dim");
      expect(pill).toBeTruthy();
    });

    it("renders state badges", () => {
      render(<SchedulerView />);
      // state badges live inside .dv-pill spans in the row meta area
      const pills = Array.from(document.querySelectorAll(".dv-pill")).map((el) => el.textContent);
      expect(pills).toContain("scheduled");
      expect(pills).toContain("error");
      expect(pills).toContain("paused");
    });

    it("shows + create job button", () => {
      render(<SchedulerView />);
      expect(screen.getByText("+ create job")).toBeTruthy();
    });
  });

  describe("state filter tabs", () => {
    it("renders all filter tabs", () => {
      render(<SchedulerView />);
      const filters = ["all", "scheduled", "running", "paused", "completed", "error"];
      for (const f of filters) {
        // Use getAllByText since some labels also appear elsewhere
        expect(screen.getAllByText(f).length).toBeGreaterThan(0);
      }
    });

    it("clicking error filter shows only error jobs", () => {
      render(<SchedulerView />);
      // Get the error filter button specifically (in the tag row area)
      const errorBtns = screen.getAllByText("error");
      // The filter button is the first occurrence (state badge appears after)
      fireEvent.click(errorBtns[0]);
      // Only error-check should be visible in the list
      expect(screen.getByText("error-check")).toBeTruthy();
      // daily-standup is scheduled, should not be in filtered results
      // (it may still be in the dom as a count label etc, check row titles)
      const rows = document.querySelectorAll(".dv-row-title");
      expect(rows.length).toBe(1);
    });

    it("clicking paused filter shows only paused jobs", () => {
      render(<SchedulerView />);
      const pausedBtns = screen.getAllByText("paused");
      fireEvent.click(pausedBtns[0]);
      const rows = document.querySelectorAll(".dv-row-title");
      expect(rows.length).toBe(1);
      expect(screen.getByText("weekly-report")).toBeTruthy();
    });

    it("enabled filter shows only enabled jobs", () => {
      render(<SchedulerView />);
      const enabledBtn = screen.getByText("enabled");
      fireEvent.click(enabledBtn);
      const rows = document.querySelectorAll(".dv-row-title");
      expect(rows.length).toBe(2); // daily-standup and error-check are enabled
    });

    it("disabled filter shows only disabled jobs", () => {
      render(<SchedulerView />);
      // The "disabled" filter button is inside the enabled/disabled button group
      const allDisabledEls = screen.getAllByText("disabled");
      // The filter button is a <button> element; the row pill is a <span>
      const disabledBtn = allDisabledEls.find((el) => el.tagName === "BUTTON");
      expect(disabledBtn).toBeTruthy();
      fireEvent.click(disabledBtn!);
      const rows = document.querySelectorAll(".dv-row-title");
      expect(rows.length).toBe(1);
    });
  });

  describe("search filter", () => {
    it("filters by job name", () => {
      render(<SchedulerView />);
      const input = screen.getByPlaceholderText("search…");
      fireEvent.change(input, { target: { value: "standup" } });
      const rows = document.querySelectorAll(".dv-row-title");
      expect(rows.length).toBe(1);
      expect(screen.getByText("daily-standup")).toBeTruthy();
    });

    it("filters by prompt content", () => {
      render(<SchedulerView />);
      const input = screen.getByPlaceholderText("search…");
      fireEvent.change(input, { target: { value: "prod logs" } });
      const rows = document.querySelectorAll(".dv-row-title");
      expect(rows.length).toBe(1);
      expect(screen.getByText("error-check")).toBeTruthy();
    });

    it("shows all jobs when search is cleared", () => {
      render(<SchedulerView />);
      const input = screen.getByPlaceholderText("search…");
      fireEvent.change(input, { target: { value: "standup" } });
      fireEvent.change(input, { target: { value: "" } });
      const rows = document.querySelectorAll(".dv-row-title");
      expect(rows.length).toBe(3);
    });
  });

  describe("create job modal", () => {
    it("opens create modal on button click", () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("+ create job"));
      expect(screen.getByText("CREATE CRONJOB")).toBeTruthy();
    });

    it("closes create modal on cancel", () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("+ create job"));
      fireEvent.click(screen.getByText("cancel"));
      expect(screen.queryByText("CREATE CRONJOB")).toBeNull();
    });

    it("shows validation error when prompt is empty", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("+ create job"));
      fireEvent.click(screen.getByText("create job"));
      await waitFor(() => {
        expect(screen.getByText("Prompt is required")).toBeTruthy();
      });
    });

    it("shows validation error when schedule is empty", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("+ create job"));
      const promptArea = screen.getByPlaceholderText(/Summarise yesterday/);
      fireEvent.change(promptArea, { target: { value: "do something" } });
      fireEvent.click(screen.getByText("create job"));
      await waitFor(() => {
        expect(screen.getByText("Schedule is required")).toBeTruthy();
      });
    });

    it("calls cronAction create with correct payload", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("+ create job"));

      const promptArea = screen.getByPlaceholderText(/Summarise yesterday/);
      fireEvent.change(promptArea, { target: { value: "run daily task" } });

      const schedInput = screen.getByPlaceholderText(/0 9 \* \* 1-5/);
      fireEvent.change(schedInput, { target: { value: "every 30m" } });

      fireEvent.click(screen.getByText("create job"));

      await waitFor(() => {
        expect(mockCronAction).toHaveBeenCalledWith(
          "create",
          undefined,
          expect.objectContaining({ prompt: "run daily task", schedule_display: "every 30m" }),
        );
      });
    });

    it("closes modal after successful create", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("+ create job"));

      const promptArea = screen.getByPlaceholderText(/Summarise yesterday/);
      fireEvent.change(promptArea, { target: { value: "run daily task" } });

      const schedInput = screen.getByPlaceholderText(/0 9 \* \* 1-5/);
      fireEvent.change(schedInput, { target: { value: "every 30m" } });

      fireEvent.click(screen.getByText("create job"));

      await waitFor(() => {
        expect(screen.queryByText("CREATE CRONJOB")).toBeNull();
      });
    });

    it("repeat defaults to infinite", () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("+ create job"));
      const infiniteRadio = screen.getByDisplayValue("infinite") as HTMLInputElement;
      expect(infiniteRadio.checked).toBe(true);
    });

    it("switching to N times shows number input", () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("+ create job"));
      const nRadio = screen.getByDisplayValue("n");
      fireEvent.click(nRadio);
      expect(screen.getByDisplayValue("1")).toBeTruthy();
    });
  });

  describe("job detail modal", () => {
    it("opens detail modal on row click", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => {
        expect(screen.getByText("PROMPT")).toBeTruthy();
      });
    });

    it("displays prompt text in detail modal", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => {
        // Prompt appears in both the row sub and the modal body
        expect(screen.getAllByText(/Summarise yesterday/i).length).toBeGreaterThan(0);
      }, { timeout: 3000 });
    });

    it("shows schedule pill in detail modal", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => {
        expect(screen.getAllByText("0 9 * * 1-5").length).toBeGreaterThan(1);
      });
    });

    it("shows last error for error-state job", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("error-check"));
      await waitFor(() => {
        expect(screen.getByText("API timeout")).toBeTruthy();
      });
    });

    it("calls queryOutputs with job id", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => {
        expect(mockQueryOutputs).toHaveBeenCalledWith("job-1", 10);
      });
    });

    it("shows no outputs yet when outputs array is empty", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => {
        expect(screen.getByText("no outputs yet")).toBeTruthy();
      });
    });

    it("renders output entries when present", async () => {
      mockQueryOutputs.mockResolvedValue([
        { job_id: "job-1", run_at: Date.now() - 3600000, output_markdown: "# Done", final_response: "all good", success: true, error_message: null },
      ]);
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => {
        expect(screen.getByText("ok")).toBeTruthy();
      });
    });

    it("shows skills list when job has skills", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => {
        expect(screen.getByText("SKILLS")).toBeTruthy();
        expect(screen.getByText("git-summary")).toBeTruthy();
      });
    });

    it("shows workdir in detail grid", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => {
        expect(screen.getByText("workdir:")).toBeTruthy();
      });
    });

    it("closes modal on close button click", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => screen.getByText("PROMPT"));
      fireEvent.click(screen.getByText("close"));
      expect(screen.queryByText("PROMPT")).toBeNull();
    });

    it("shows pause button for scheduled job", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => {
        expect(screen.getByText("pause")).toBeTruthy();
      });
    });

    it("shows resume button for paused job", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("weekly-report"));
      await waitFor(() => {
        expect(screen.getByText("resume")).toBeTruthy();
      });
    });

    it("calls cronAction pause on click", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => screen.getByText("pause"));
      fireEvent.click(screen.getByText("pause"));
      await waitFor(() => {
        expect(mockCronAction).toHaveBeenCalledWith("pause", "job-1");
      });
    });

    it("calls cronAction run-now on click", async () => {
      render(<SchedulerView />);
      fireEvent.click(screen.getByText("daily-standup"));
      await waitFor(() => screen.getByText("run now"));
      fireEvent.click(screen.getByText("run now"));
      await waitFor(() => {
        expect(mockCronAction).toHaveBeenCalledWith("run-now", "job-1");
      });
    });
  });

  describe("empty and error states", () => {
    it("shows no jobs message when list is empty", () => {
      MOCK_JOBS = [];
      render(<SchedulerView />);
      expect(screen.getByText(/no jobs yet/)).toBeTruthy();
    });
  });
});
