/**
 * The sort header the domain tables share — and the arrow direction they have
 * to agree on.
 *
 * Two of the three list pages once built this button by hand and showed the
 * OPPOSITE arrow: ascending was a down arrow on flights and cruises. Someone
 * moving between the pages saw the same sort state with a reversed sign. Up
 * means ascending (A→Z and early→late read upward); `Table` now owns the
 * header, so a page cannot draw its own.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Table, TableRow, type TableColumn } from "../Table";

function renderTable(order: "asc" | "desc", active = true) {
  const onSort = vi.fn();
  const columns: TableColumn[] = [
    {
      key: "name",
      label: "Name",
      min: 100,
      sort: { active, order, onSort, ariaLabel: "Nach Name sortieren" },
    },
    { key: "n", label: "Zahl", min: 80 },
  ];
  render(
    <Table columns={columns} label="Liste">
      <TableRow columns={columns} cells={["Anna", "1"]} />
    </Table>
  );
  return { onSort };
}

describe("Table sortable columns", () => {
  it("marks the sorted column with aria-sort and points UP for ascending", () => {
    renderTable("asc");
    const header = screen.getAllByRole("columnheader")[0];
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(header.querySelector("path")?.getAttribute("d")).toBe("m18 15-6-6-6 6");
  });

  it("points DOWN for descending", () => {
    renderTable("desc");
    const header = screen.getAllByRole("columnheader")[0];
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(header.querySelector("path")?.getAttribute("d")).toBe("m6 9 6 6 6-6");
  });

  it("reports aria-sort none on an unsorted sortable column and nothing on a plain one", () => {
    renderTable("asc", false);
    expect(screen.getAllByRole("columnheader")[0].getAttribute("aria-sort")).toBe("none");
    expect(screen.getAllByRole("columnheader")[1].hasAttribute("aria-sort")).toBe(false);
  });

  it("sorts on click", () => {
    const { onSort } = renderTable("asc");
    fireEvent.click(screen.getByRole("button", { name: "Nach Name sortieren" }));
    expect(onSort).toHaveBeenCalledTimes(1);
  });
});
