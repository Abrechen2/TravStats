import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, type TableColumn } from "../Table";

// CT106 design-6 M01: at 390px the lodging list, already collapsed into rows,
// still said "the table is wider than the view — scroll sideways" and that six
// columns had stepped aside. Both sentences were computed from desktop column
// minimums while CSS drew the phone layout.
const COLUMNS: TableColumn[] = [
  { key: "name", label: "Name", min: 300 },
  { key: "city", label: "City", min: 200 },
  { key: "price", label: "Price", min: 120, priority: 3 },
];

const stubViewport = (narrow: boolean): void => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: narrow && query.includes("max-width: 639px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
};

describe("Table — hints follow the layout actually drawn", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      }
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(340);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderTable = (): void => {
    render(
      <Table
        columns={COLUMNS}
        label="Stays"
        hiddenColumnsHint={(n) => `hidden:${n}`}
        scrollHint="scroll-hint"
      >
        <div role="row" />
      </Table>
    );
  };

  it("says neither sentence below 640px, where the rows are a list", () => {
    stubViewport(true);
    renderTable();

    expect(screen.queryByText("scroll-hint")).toBeNull();
    expect(screen.queryByText(/^hidden:/)).toBeNull();
  });

  it("still says both on a desktop table that is too narrow", () => {
    stubViewport(false);
    renderTable();

    expect(screen.getByText("scroll-hint")).toBeInTheDocument();
    expect(screen.getByText("hidden:1")).toBeInTheDocument();
  });
});
