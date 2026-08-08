import { describe, it, expect } from "vitest";
import { resolveReplyInput } from "../src/replyArgs.js";

/**
 * Guards the 2026-08-08 incident: a multi-line message passed as a CLI argument
 * was cut at the first newline on Windows, and the trailing `--dry-run` was
 * dropped from argv with it — so a truncated fragment posted for real.
 */
const argv = (...rest: string[]) => ["node", "index.ts", "reply", ...rest];

describe("resolveReplyInput", () => {
  it("accepts a message from a file", () => {
    expect(resolveReplyInput(argv("dev-talk", "--file", "notes.md"))).toEqual({
      kind: "file",
      channel: "dev-talk",
      path: "notes.md",
    });
  });

  it("accepts a single-line inline message", () => {
    expect(resolveReplyInput(argv("dev-talk", "thanks,", "shipped"))).toEqual({
      kind: "inline",
      channel: "dev-talk",
      message: "thanks, shipped",
    });
  });

  it("does not treat --dry-run as part of the message", () => {
    expect(resolveReplyInput(argv("dev-talk", "shipped", "--dry-run"))).toEqual({
      kind: "inline",
      channel: "dev-talk",
      message: "shipped",
    });
  });

  it("refuses an inline message containing a newline, naming --file as the way", () => {
    const out = resolveReplyInput(argv("dev-talk", "line one\nline two"));
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.reason).toMatch(/--file/);
  });

  it("refuses when no message was given at all", () => {
    expect(resolveReplyInput(argv("dev-talk")).kind).toBe("error");
  });

  it("refuses when no channel was given", () => {
    expect(resolveReplyInput(argv()).kind).toBe("error");
  });

  it("refuses --file without a path rather than silently going inline", () => {
    expect(resolveReplyInput(argv("dev-talk", "--file")).kind).toBe("error");
  });
});
