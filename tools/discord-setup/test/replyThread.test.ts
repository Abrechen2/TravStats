import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ThreadChannel } from "discord.js";
import { resolveThread } from "../src/replyThread.js";

/** Minimal stand-in — resolveThread only reads `id` and `name`. */
function thread(id: string, name: string): ThreadChannel {
  return { id, name } as ThreadChannel;
}

const threads = [
  thread("111", "Kreise in der Timeline von Reisen"),
  thread("222", "Plural Nächte"),
  thread("333", "Einfügen von Koordinaten"),
];

describe("resolveThread", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("matches an exact thread id", () => {
    expect(resolveThread(threads, "222")?.id).toBe("222");
  });

  it("matches a unique case-insensitive title substring", () => {
    expect(resolveThread(threads, "timeline")?.id).toBe("111");
  });

  it("returns null when nothing matches", () => {
    expect(resolveThread(threads, "no such post")).toBeNull();
  });

  it("returns null when a substring is ambiguous", () => {
    const dupes = [thread("a", "Bug one"), thread("b", "Bug two")];
    expect(resolveThread(dupes, "bug")).toBeNull();
  });

  it("prefers an exact id over a title substring", () => {
    const items = [thread("timeline", "Unrelated"), thread("999", "timeline stuff")];
    expect(resolveThread(items, "timeline")?.id).toBe("timeline");
  });
});
