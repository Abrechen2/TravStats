import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client, TextChannel, ThreadChannel } from "discord.js";
import { findExactMatches, resolveReplyTarget, resolveThread, runReply } from "../src/replyThread.js";

/** Minimal stand-in — resolveThread only reads `id` and `name`. */
function thread(id: string, name: string): ThreadChannel {
  return { id, name } as ThreadChannel;
}

/** Minimal stand-in — the resolvers only read `id` and `name`. */
function channel(id: string, name: string): TextChannel {
  return { id, name } as TextChannel;
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

describe("findExactMatches", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("finds an exact channel-name match", () => {
    const channels = [channel("c1", "support"), channel("c2", "general")];
    const matches = findExactMatches(threads, channels, "support");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "channel", value: { id: "c1" } });
  });

  it("finds an exact thread-name match", () => {
    const matches = findExactMatches(threads, [], "Plural Nächte");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: "thread", value: { id: "222" } });
  });

  it("strips a leading # before comparing channel names", () => {
    const channels = [channel("c1", "support")];
    expect(findExactMatches([], channels, "#support")).toHaveLength(1);
  });

  it("does not match a substring — exact only", () => {
    const channels = [channel("c1", "support-eu")];
    expect(findExactMatches([], channels, "support")).toHaveLength(0);
  });

  it("reports both a thread and a channel that exact-match the same query", () => {
    const channels = [channel("c1", "support")];
    const withSupportThread = [...threads, thread("t1", "support")];
    const matches = findExactMatches(withSupportThread, channels, "support");
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.kind).sort()).toEqual(["channel", "thread"]);
  });
});

describe("resolveReplyTarget", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("an exact channel match wins over a thread that only substring-matches", () => {
    // The concrete failure scenario: a text channel #support exists, and some
    // forum has a thread titled "Support ticket: xyz" — only the latter
    // substring-matches, but the channel matches "support" exactly and must win.
    const withFuzzyThread = [...threads, thread("t1", "Support ticket: xyz")];
    const channels = [channel("c1", "support"), channel("c2", "general")];
    const target = resolveReplyTarget(withFuzzyThread, channels, "support");
    expect(target?.id).toBe("c1");
  });

  it("falls back to the unique fuzzy thread match when nothing matches exactly", () => {
    const target = resolveReplyTarget(threads, [channel("c1", "general")], "timeline");
    expect(target?.id).toBe("111");
  });

  it("aborts (returns null) when a thread and a channel both match the query exactly", () => {
    const withSupportThread = [...threads, thread("t1", "support")];
    const channels = [channel("c1", "support")];
    expect(resolveReplyTarget(withSupportThread, channels, "support")).toBeNull();
  });

  it("returns null when nothing matches at all", () => {
    expect(resolveReplyTarget(threads, [channel("c1", "general")], "no such thing")).toBeNull();
  });
});

describe("runReply promise settlement", () => {
  // discord.js's `login()` resolves on the raw gateway READY dispatch, which
  // fires BEFORE `clientReady` — the event the actual reply work runs on.
  // These tests pin down that runReply's returned promise tracks
  // `clientReady` (+ destroy), not the earlier `login()` resolution — see the
  // runReply docstring in src/replyThread.ts.

  it("does not settle just because login() resolved — only once clientReady's work finishes", async () => {
    // `once` intentionally never invokes the captured handler, emulating a
    // client that logged in but never received `clientReady`. If runReply
    // settled as soon as login() resolves (the bug), this promise would have
    // fulfilled by the time the microtask queue drains below.
    const login = vi.fn().mockResolvedValue("token");
    const once = vi.fn();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const client = { login, once, destroy } as unknown as Client;

    let settled = false;
    void runReply(client, "token", "guild", "support", "hi", false).then(() => {
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

    await expect(runReply(client, "bad-token", "guild", "support", "hi", false)).rejects.toThrow(
      "bad token",
    );
  });
});
