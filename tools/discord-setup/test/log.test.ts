import { describe, it, expect, vi } from "vitest";
import { log, dryRunLog } from "../src/log.js";

describe("log", () => {
  it("writes the message verbatim", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  it("dryRunLog prefixes with [dry-run]", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    dryRunLog("would create #rules");
    expect(spy).toHaveBeenCalledWith("[dry-run] would create #rules");
    spy.mockRestore();
  });
});
