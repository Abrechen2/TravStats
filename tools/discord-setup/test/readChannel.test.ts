import { describe, it, expect, vi } from "vitest";
import type { Client } from "discord.js";
import { formatMessage, parseLimit, runRead } from "../src/readChannel.js";

describe("formatMessage and embeds", () => {
  // Every announcement this tool posts is an embed with no message content.
  // A reader that showed only `content` rendered each one as "(no text
  // content)", so reading the channel back could not tell a complete
  // announcement from an empty post — and was reported as verification.
  it("prints an embed's title and description", () => {
    const out = formatMessage("bot#1", "2026-08-22T15:23:36.684Z", "", [
      { title: "Release Candidate 2.6.0-rc.10", description: "line one\nline two" },
    ]);
    expect(out).toContain("(embed only)");
    expect(out).toContain("embed[0] title: Release Candidate 2.6.0-rc.10");
    expect(out).toContain("line one");
    expect(out).toContain("line two");
  });

  it("still says (no text content) when there is nothing at all", () => {
    expect(formatMessage("bot#1", "2026-08-22T15:23:36.684Z", "")).toContain("(no text content)");
  });

  it("names an embed that carries no description instead of printing nothing", () => {
    const out = formatMessage("bot#1", "2026-08-22T15:23:36.684Z", "", [{ title: "Bare" }]);
    expect(out).toContain("(no description)");
  });

  it("keeps the message text when both are present", () => {
    const out = formatMessage("bot#1", "2026-08-22T15:23:36.684Z", "see below", [
      { title: "T", description: "D" },
    ]);
    expect(out).toContain("see below");
    expect(out).toContain("embed[0] title: T");
  });
});

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

describe("parseLimit", () => {
  it("defaults to 20 when no argument is given", () => {
    expect(parseLimit(undefined)).toBe(20);
  });

  it("defaults to 20 for non-numeric input", () => {
    expect(parseLimit("abc")).toBe(20);
  });

  it("defaults to 20 for zero", () => {
    expect(parseLimit("0")).toBe(20);
  });

  it("defaults to 20 for a negative number", () => {
    expect(parseLimit("-5")).toBe(20);
  });

  it("defaults to 20 for a non-integer number", () => {
    expect(parseLimit("12.5")).toBe(20);
  });

  it("passes through a value within range", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("20")).toBe(20);
    expect(parseLimit("99")).toBe(99);
  });

  it("passes through exactly the maximum", () => {
    expect(parseLimit("100")).toBe(100);
  });

  it("clamps values above the maximum to 100, rather than falling back to the default", () => {
    expect(parseLimit("500")).toBe(100);
    expect(parseLimit("101")).toBe(100);
  });
});

describe("runRead promise settlement", () => {
  // discord.js's `login()` resolves on the raw gateway READY dispatch, which
  // fires BEFORE `clientReady` — the event the actual read work runs on.
  // These tests pin down that runRead's returned promise tracks `clientReady`
  // (+ destroy), not the earlier `login()` resolution — see the runRead
  // docstring in src/readChannel.ts.

  it("does not settle just because login() resolved — only once clientReady's work finishes", async () => {
    // `once` intentionally never invokes the captured handler, emulating a
    // client that logged in but never received `clientReady`. If runRead
    // settled as soon as login() resolves (the bug), this promise would have
    // fulfilled by the time the microtask queue drains below.
    const login = vi.fn().mockResolvedValue("token");
    const once = vi.fn();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const client = { login, once, destroy } as unknown as Client;

    let settled = false;
    void runRead(client, "token", "guild", "general", 20).then(() => {
      settled = true;
    });

    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(login).toHaveBeenCalledWith("token");
    expect(settled).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("rejects instead of hanging forever when login() rejects (e.g. a bad token)", async () => {
    const login = vi.fn().mockRejectedValue(new Error("bad token"));
    const once = vi.fn();
    const client = { login, once, destroy: vi.fn() } as unknown as Client;

    await expect(runRead(client, "bad-token", "guild", "general", 20)).rejects.toThrow(
      "bad token",
    );
  });
});
