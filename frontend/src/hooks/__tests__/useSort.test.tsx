import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSort } from "../useSort";

interface Row {
  name: string;
  km: number | null;
}
const ROWS: Row[] = [
  { name: "b", km: 20 },
  { name: "a", km: null },
  { name: "c", km: 5 },
  { name: "d", km: 12 },
];
const ACCESSORS = { name: (r: Row) => r.name, km: (r: Row) => r.km };

describe("useSort", () => {
  beforeEach(() => localStorage.clear());

  it("puts a row with no value last in BOTH directions (null is not zero)", () => {
    const { result } = renderHook(() =>
      useSort<Row, "name" | "km">({
        tableKey: "test-null",
        rows: ROWS,
        accessors: ACCESSORS,
        defaultBy: "km",
      })
    );
    expect(result.current.rows.map((r) => r.name)).toEqual(["c", "d", "b", "a"]);
    act(() => result.current.toggle("km"));
    expect(result.current.rows.map((r) => r.name)).toEqual(["b", "d", "c", "a"]);
  });

  it("starts a newly chosen column ascending, or descending where it reads better", () => {
    const { result } = renderHook(() =>
      useSort<Row, "name" | "km">({
        tableKey: "test-first",
        rows: ROWS,
        accessors: ACCESSORS,
        defaultBy: "name",
        descendingFirst: ["km"],
      })
    );
    act(() => result.current.toggle("km"));
    expect(result.current.sortBy).toBe("km");
    expect(result.current.sortOrder).toBe("desc");
  });

  it("remembers the choice per list", () => {
    const first = renderHook(() =>
      useSort<Row, "name" | "km">({
        tableKey: "test-remember",
        rows: ROWS,
        accessors: ACCESSORS,
        defaultBy: "name",
      })
    );
    act(() => first.result.current.toggle("km"));
    first.unmount();
    const second = renderHook(() =>
      useSort<Row, "name" | "km">({
        tableKey: "test-remember",
        rows: ROWS,
        accessors: ACCESSORS,
        defaultBy: "name",
      })
    );
    expect(second.result.current.sortBy).toBe("km");
  });

  it("does not reorder the rows it was given", () => {
    const copy = [...ROWS];
    renderHook(() =>
      useSort<Row, "name" | "km">({
        tableKey: "test-pure",
        rows: ROWS,
        accessors: ACCESSORS,
        defaultBy: "name",
      })
    );
    expect(ROWS).toEqual(copy);
  });
});
