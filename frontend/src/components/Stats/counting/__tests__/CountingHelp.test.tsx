import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CountingHelp from "../CountingHelp";
import { COUNTING_FIELDS, countingSource, type CountingEntry } from "../countingEntry";

const ENTRIES: CountingEntry[] = [
  { term: "Reisen", helpKey: "rail:stats.help.journeys" },
  { term: "Umstiege", helpKey: "rail:stats.help.transfers" },
];

function pointer(coarse: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("CountingHelp", () => {
  // A native <summary>: the browser opens it with Enter or Space once it has
  // focus. jsdom does not run that activation, so the test proves the two
  // halves it can see — Tab reaches the summary, and activating it opens.
  it("is closed, reachable by Tab, and opens on activation", async () => {
    render(<CountingHelp entries={ENTRIES} testId="help" />);
    const help = screen.getByTestId("help");
    expect(help.tagName).toBe("DETAILS");
    expect(help).not.toHaveAttribute("open");
    const summary = within(help).getByText("stats:counting.summary");
    expect(summary.tagName).toBe("SUMMARY");
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(summary);
    await user.click(summary);
    expect(help).toHaveAttribute("open");
  });

  it("answers all five questions for every figure, under the figure's name", () => {
    render(<CountingHelp entries={ENTRIES} />);
    for (const entry of ENTRIES) {
      const region = screen.getByRole("region", { name: entry.term, hidden: true });
      expect(within(region).getByText(entry.term)).toBeTruthy();
      for (const field of COUNTING_FIELDS) {
        expect(within(region).getByText(`stats:counting.fields.${field}`)).toBeTruthy();
        expect(within(region).getByText(`${entry.helpKey}.${field}`)).toBeTruthy();
      }
    }
  });

  it("does not repeat the name of a single figure it sits under", () => {
    render(<CountingHelp entries={[ENTRIES[0]]} />);
    expect(screen.getByRole("region", { name: "Reisen", hidden: true })).toBeTruthy();
    expect(screen.queryByText("Reisen")).toBeNull();
  });

  it("renders nothing without a figure to explain", () => {
    const { container } = render(<CountingHelp entries={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("grows the summary to a 44 px target under a finger, and only there", () => {
    pointer(true);
    const { unmount } = render(<CountingHelp entries={ENTRIES} />);
    expect(screen.getByText("stats:counting.summary").className).toContain("min-h-11");
    unmount();
    pointer(false);
    render(<CountingHelp entries={ENTRIES} />);
    expect(screen.getByText("stats:counting.summary").className).not.toContain("min-h-11");
  });

  it("keeps the browser's focus outline (nothing removes it)", () => {
    render(<CountingHelp entries={ENTRIES} />);
    expect(screen.getByText("stats:counting.summary").className).not.toMatch(
      /outline-(none|hidden)/
    );
  });
});

describe("countingSource", () => {
  it("points at the five answers under `<base>.help`", () => {
    expect(countingSource("lodging:stats.insights.week")).toEqual({
      helpKey: "lodging:stats.insights.week.help",
    });
    expect(countingSource("lodging:stats.insights.week", { n: 2 })).toEqual({
      helpKey: "lodging:stats.insights.week.help",
      values: { n: 2 },
    });
  });
});
