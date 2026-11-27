import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TableRow, type TableColumn } from "../Table";

const COLUMNS: TableColumn[] = [
  { key: "name", label: "Name", min: 200 },
  { key: "time", label: "Time", min: 100, mono: true },
  { key: "price", label: "Price", min: 100, align: "end" },
];

describe("TableRow numeric cells", () => {
  it("keeps a mono or right-aligned cell on one line (the flight time wrapped '2 h 07 / min')", () => {
    render(<TableRow columns={COLUMNS} cells={["Lisbon", "2 h 07 min", "120 €"]} />);
    expect(screen.getByText("2 h 07 min").closest("[role=cell]")).toHaveStyle({
      whiteSpace: "nowrap",
    });
    expect(screen.getByText("120 €").closest("[role=cell]")).toHaveStyle({ whiteSpace: "nowrap" });
    expect(screen.getByText("Lisbon").closest("[role=cell]")).not.toHaveStyle({
      whiteSpace: "nowrap",
    });
  });
});
