/**
 * The split the bar exists to enforce: search, status and year are OPEN on
 * every domain list, everything one domain owns is behind the button. If a
 * page ever puts its domain filter in the open row again, the bars stop being
 * the same width and the alignment is gone.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ListFilterBar, { FilterField } from "../ListFilterBar";

function renderBar(overrides: Partial<Parameters<typeof ListFilterBar>[0]> = {}) {
  const props = {
    search: { value: "", onChange: vi.fn(), placeholder: "Suchen…" },
    status: {
      label: "Status",
      value: "all",
      onChange: vi.fn(),
      allLabel: "Alle Status",
      options: [{ value: "flown", label: "Geflogen" }],
    },
    year: {
      label: "Jahr",
      value: "all",
      onChange: vi.fn(),
      allLabel: "Alle Jahre",
      options: [{ value: "2024", label: "2024" }],
    },
    extra: (
      <FilterField label="Airline">
        <select aria-label="Airline">
          <option value="all">Alle</option>
        </select>
      </FilterField>
    ),
    hasActiveFilter: false,
    onReset: vi.fn(),
    resultLabel: "3 Einträge",
    ...overrides,
  };
  return { props, ...render(<ListFilterBar {...props} />) };
}

describe("ListFilterBar", () => {
  it("keeps search, status and year open and the domain filter behind the button", async () => {
    renderBar();

    expect(screen.getByPlaceholderText("Suchen…")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Jahr")).toBeInTheDocument();
    expect(screen.queryByLabelText("Airline")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("list-filter-more"));
    expect(within(screen.getByRole("dialog")).getByLabelText("Airline")).toBeInTheDocument();
  });

  it("counts the hidden filters on the button, because a closed panel hides its own state", () => {
    renderBar({ extraActiveCount: 2 });
    expect(screen.getByTestId("list-filter-badge").textContent).toBe("2");
  });

  it("shows no badge when nothing hidden is set", () => {
    renderBar();
    expect(screen.queryByTestId("list-filter-badge")).not.toBeInTheDocument();
  });

  it("closes on Escape — the map panel it replaces only ever handled the click", async () => {
    renderBar();
    await userEvent.click(screen.getByTestId("list-filter-more"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers reset only while something is set", async () => {
    const { props } = renderBar({ hasActiveFilter: true });
    await userEvent.click(screen.getByRole("button", { name: "common:filters.reset" }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it("hides reset when no filter is set", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: "common:filters.reset" })).not.toBeInTheDocument();
  });

  it("drops the whole button when a domain brings no filters of its own", () => {
    renderBar({ extra: undefined });
    expect(screen.queryByTestId("list-filter-more")).not.toBeInTheDocument();
  });
});
