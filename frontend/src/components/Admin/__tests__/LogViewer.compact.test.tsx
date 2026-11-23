import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LogViewer from "../LogViewer";

const api = vi.hoisted(() => ({ readLogFile: vi.fn() }));
vi.mock("../../../lib/api", () => ({ adminApi: api }));
const tr = vi.hoisted(() => ({ t: (k: string) => k, i18n: { language: "de" } }));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => tr }));

const entries = Array.from({ length: 20 }, (_, i) => ({
  timestamp: "2026-11-23T10:00:00Z",
  level: "error",
  category: "http",
  message: `boom ${i} ${"x".repeat(300)}`,
}));

afterEach(cleanup);

describe("LogViewer compact list", () => {
  const show = async (): Promise<void> => {
    api.readLogFile.mockResolvedValue({ entries, total: 20, offset: 0, hasMore: false });
    render(<LogViewer files={[]} selectedFile="app.log" onSelectFile={() => {}} />);
    await screen.findByTestId("log-viewer-list");
  };

  it("keeps one fixed-height keyboard-scrollable list of one-line rows", async () => {
    await show();
    const list = screen.getByTestId("log-viewer-list");
    expect(list.tabIndex).toBe(0);
    expect(list.style.maxHeight).toBe("288px");
    expect(list.className).toContain("overflow-y-auto");
    expect(screen.getAllByTestId("log-entry")).toHaveLength(20);
    expect(screen.queryByText(/"category"/)).toBeNull();
  });

  it("expands one entry's details on click and collapses it again", async () => {
    await show();
    const [first, second] = screen.getAllByRole("button", { expanded: false });
    fireEvent.click(first);
    await waitFor(() => expect(screen.getAllByText(/"category": "http"/)).toHaveLength(1));
    expect(second.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(first);
    expect(screen.queryByText(/"category": "http"/)).toBeNull();
  });
});
