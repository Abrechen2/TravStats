/**
 * Column visibility for the domain list tables (owner ask 2026-08-20). The
 * stored value is the HIDDEN set, so a column added in a later release is
 * visible by default for users with an old preference blob.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useColumnPrefs } from "../useColumnPrefs";

describe("useColumnPrefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows every column by default, including ids it has never seen", () => {
    const { result } = renderHook(() => useColumnPrefs("test-table"));
    expect(result.current.isVisible("anything")).toBe(true);
  });

  it("toggles a column off and persists the choice", () => {
    const { result } = renderHook(() => useColumnPrefs("test-table"));
    act(() => result.current.toggle("spend"));
    expect(result.current.isVisible("spend")).toBe(false);

    // A fresh mount (new page visit) reads the persisted state back.
    const { result: fresh } = renderHook(() => useColumnPrefs("test-table"));
    expect(fresh.current.isVisible("spend")).toBe(false);
    expect(fresh.current.isVisible("name")).toBe(true);
  });

  it("refuses to hide an always-visible column", () => {
    const { result } = renderHook(() => useColumnPrefs("test-table", ["name"]));
    act(() => result.current.toggle("name"));
    expect(result.current.isVisible("name")).toBe(true);
  });

  it("keeps tables independent of each other", () => {
    const { result: a } = renderHook(() => useColumnPrefs("table-a"));
    act(() => a.current.toggle("x"));
    const { result: b } = renderHook(() => useColumnPrefs("table-b"));
    expect(b.current.isVisible("x")).toBe(true);
  });

  it("survives an unreadable preference blob", () => {
    localStorage.setItem("travstats:table-hidden-columns:test-table", "{not json");
    const { result } = renderHook(() => useColumnPrefs("test-table"));
    expect(result.current.isVisible("spend")).toBe(true);
  });
});
