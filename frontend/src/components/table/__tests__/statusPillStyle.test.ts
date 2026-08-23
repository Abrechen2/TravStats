/**
 * The bug this file exists to prevent: the flights table wrote its status
 * colours as a nested ternary whose ELSE branch caught everything that was not
 * flown or scheduled. A `historical` flight — real, just recorded without
 * exact times — came out in the cancelled red, indistinguishable from one that
 * never took off.
 */
import { describe, it, expect } from "vitest";
import { statusPillStyle } from "../statusPillStyle";

describe("statusPillStyle", () => {
  it("does not paint a historical entry like a cancelled one", () => {
    expect(statusPillStyle("historical")).not.toEqual(statusPillStyle("cancelled"));
  });

  it("gives historical the archival amber", () => {
    expect(statusPillStyle("historical").color).toBe("#fbbf24");
  });

  it("gives cancelled the danger colour", () => {
    expect(statusPillStyle("cancelled").color).toBe("var(--danger)");
  });

  it("treats the done states alike across domains", () => {
    // A flown flight and a completed stay are the same state in two vocabularies.
    expect(statusPillStyle("completed")).toEqual(statusPillStyle("flown"));
  });

  it("treats the upcoming states alike across domains", () => {
    expect(statusPillStyle("booked")).toEqual(statusPillStyle("scheduled"));
  });

  it("keeps in_progress distinct from both past and future", () => {
    const running = statusPillStyle("in_progress");
    expect(running).not.toEqual(statusPillStyle("flown"));
    expect(running).not.toEqual(statusPillStyle("scheduled"));
  });

  it("does not reuse the brand accent for a status", () => {
    // Lodging painted in_progress in the accent orange, which already means
    // "the thing you are looking at" everywhere else.
    expect(statusPillStyle("in_progress").color).not.toContain("--accent");
  });

  it("renders an unknown status neutrally, not as cancelled", () => {
    const unknown = statusPillStyle("something-new");
    expect(unknown).not.toEqual(statusPillStyle("cancelled"));
    expect(unknown.color).toBe("var(--text-muted)");
  });
});
