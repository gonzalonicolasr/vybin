// Basic unit test structure for TabBar component.
// Run with: bun test (after adding vitest to devDependencies)
// or: npx vitest run
//
// These tests verify the tab bar renders and keyboard/mouse interactions
// trigger the correct callbacks. Tauri invoke is not called by TabBar directly
// so no mocking of the Tauri API is needed here.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TabBar } from "./TabBar";
import type { Tab } from "./hooks/useTabs";

function makeTab(id: string, title: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    title,
    history: [],
    busy: false,
    ready: false,
    meta: null,
    ...overrides,
  };
}

describe("TabBar", () => {
  const tab1 = makeTab("id-1", "tab 1", { ready: true });
  const tab2 = makeTab("id-2", "tab 2", { busy: true });
  const tabs = [tab1, tab2];

  it("renders all tab titles", () => {
    render(
      <TabBar
        tabs={tabs}
        activeTabId="id-1"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    expect(screen.getByText("tab 1")).toBeTruthy();
    expect(screen.getByText("tab 2")).toBeTruthy();
  });

  it("calls onSwitch when a tab is clicked", () => {
    const onSwitch = vi.fn();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="id-1"
        onSwitch={onSwitch}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("tab 2").closest(".tab-item")!);
    expect(onSwitch).toHaveBeenCalledWith("id-2");
  });

  it("calls onClose with correct id when close button clicked", () => {
    const onClose = vi.fn();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="id-1"
        onSwitch={vi.fn()}
        onClose={onClose}
        onNew={vi.fn()}
      />,
    );
    // Both tabs visible — canClose is true because tabs.length > 1
    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    fireEvent.click(closeButtons[0]!); // close first tab
    expect(onClose).toHaveBeenCalledWith("id-1");
  });

  it("does not render close button when only one tab", () => {
    const singleTab = [tab1];
    render(
      <TabBar
        tabs={singleTab}
        activeTabId="id-1"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("calls onNew when + button is clicked", () => {
    const onNew = vi.fn();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="id-1"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onNew={onNew}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new tab/i }));
    expect(onNew).toHaveBeenCalled();
  });

  it("marks the active tab with aria-selected=true", () => {
    render(
      <TabBar
        tabs={tabs}
        activeTabId="id-2"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    const activeItem = screen.getByText("tab 2").closest("[role=tab]");
    expect(activeItem?.getAttribute("aria-selected")).toBe("true");
  });

  it("busy tab dot has busy class", () => {
    const { container } = render(
      <TabBar
        tabs={tabs}
        activeTabId="id-1"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    // Second tab (id-2) has busy:true
    const tabItems = container.querySelectorAll(".tab-item");
    const busyDot = tabItems[1]?.querySelector(".tab-dot-busy");
    expect(busyDot).toBeTruthy();
  });
});
