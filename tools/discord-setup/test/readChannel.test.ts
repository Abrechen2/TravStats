import { describe, it, expect } from "vitest";
import { formatMessage } from "../src/readChannel.js";

describe("formatMessage", () => {
  it("renders author, timestamp and content on one line", () => {
    expect(formatMessage("alice#0", "2026-07-04T10:00:00.000Z", "hello there")).toBe(
      "[2026-07-04T10:00:00.000Z] alice#0: hello there",
    );
  });

  it("falls back to a placeholder when content is empty (missing Message Content intent)", () => {
    expect(formatMessage("bob#0", "2026-07-04T10:00:00.000Z", "")).toBe(
      "[2026-07-04T10:00:00.000Z] bob#0: (no text content)",
    );
  });

  it("treats whitespace-only content as empty", () => {
    expect(formatMessage("carol#0", "2026-07-04T10:00:00.000Z", "   \n ")).toBe(
      "[2026-07-04T10:00:00.000Z] carol#0: (no text content)",
    );
  });
});
