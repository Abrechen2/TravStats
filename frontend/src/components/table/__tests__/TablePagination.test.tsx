import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TablePagination, { paginationRange } from "../TablePagination";

describe("paginationRange", () => {
  it("computes the range for a middle page", () => {
    expect(paginationRange(2, 50, 123)).toEqual({ from: 51, to: 100 });
  });

  it("caps the upper bound at the total on the last, partial page", () => {
    expect(paginationRange(3, 50, 123)).toEqual({ from: 101, to: 123 });
  });

  it("spans the whole set when the size is 'all'", () => {
    expect(paginationRange(1, "all", 123)).toEqual({ from: 1, to: 123 });
  });

  it("is 0-0 for an empty set, not 1-0", () => {
    expect(paginationRange(1, 50, 0)).toEqual({ from: 0, to: 0 });
  });
});

// The global react-i18next mock (src/__tests__/setup.ts) returns the raw key
// as `t`'s output and drops interpolation params entirely — the exact
// "51–100 von 123" copy is covered by the `paginationRange` unit tests above.
// What's load-bearing here is the wiring: which button calls which setter,
// and when they disable.
describe("TablePagination", () => {
  /**
   * Beta audit 2026-09-19, unlisted finding 7: the "Zeilen pro Seite" select
   * on /lodging and /flights was read as having an empty aria-label -- the one
   * control in this row without a name of its own, beside four buttons that
   * each carry one.
   *
   * Measured before changing anything: the wrapping <label> DOES name it, so
   * `getByLabelText` passed already and a test written that way would have
   * been vacuous. What was missing is the explicit attribute, which is what
   * the audit read and what survives the <label> wrapper being refactored
   * away. The assertion is therefore on the attribute, deliberately.
   */
  it("names the page-size select explicitly, not only through its wrapper", () => {
    render(
      <TablePagination
        page={1}
        pageCount={3}
        pageSize={25}
        total={60}
        setPage={vi.fn()}
        setPageSize={vi.fn()}
      />
    );
    const select = screen.getByLabelText("common:table.pagination.pageSize");
    expect(select.getAttribute("aria-label")).toBe("common:table.pagination.pageSize");
  });

  it("renders the range text", () => {
    render(
      <TablePagination
        page={2}
        pageCount={3}
        pageSize={50}
        total={123}
        setPage={vi.fn()}
        setPageSize={vi.fn()}
      />
    );
    expect(screen.getByText("common:table.pagination.range")).toBeInTheDocument();
  });

  it("calls setPage on next/prev, one page at a time", async () => {
    const user = userEvent.setup();
    const setPage = vi.fn();
    render(
      <TablePagination
        page={2}
        pageCount={3}
        pageSize={50}
        total={123}
        setPage={setPage}
        setPageSize={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "common:table.pagination.next" }));
    expect(setPage).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole("button", { name: "common:table.pagination.previous" }));
    expect(setPage).toHaveBeenCalledWith(1);
  });

  it("jumps to the first/last page", async () => {
    const user = userEvent.setup();
    const setPage = vi.fn();
    render(
      <TablePagination
        page={2}
        pageCount={5}
        pageSize={25}
        total={123}
        setPage={setPage}
        setPageSize={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "common:table.pagination.first" }));
    expect(setPage).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole("button", { name: "common:table.pagination.last" }));
    expect(setPage).toHaveBeenCalledWith(5);
  });

  it("disables previous/first on page 1 and next/last on the last page", () => {
    render(
      <TablePagination
        page={1}
        pageCount={1}
        pageSize={50}
        total={10}
        setPage={vi.fn()}
        setPageSize={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "common:table.pagination.first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "common:table.pagination.previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "common:table.pagination.next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "common:table.pagination.last" })).toBeDisabled();
  });

  it("calls setPageSize from the labelled select", async () => {
    const user = userEvent.setup();
    const setPageSize = vi.fn();
    render(
      <TablePagination
        page={1}
        pageCount={3}
        pageSize={50}
        total={123}
        setPage={vi.fn()}
        setPageSize={setPageSize}
      />
    );
    const select = screen.getByLabelText("common:table.pagination.pageSize");
    await user.selectOptions(select, "100");
    expect(setPageSize).toHaveBeenCalledWith(100);
    await user.selectOptions(select, "all");
    expect(setPageSize).toHaveBeenCalledWith("all");
  });
});
