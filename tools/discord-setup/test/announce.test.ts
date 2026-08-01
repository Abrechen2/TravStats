import { describe, it, expect, vi } from "vitest";
import type { Client } from "discord.js";
import { buildAnnounceEmbed, channelForType, runAnnounce } from "../src/announce.js";

describe("channelForType", () => {
  it("routes beta → beta-channel, rc → release-candidate, release → announcements", () => {
    expect(channelForType("beta")).toBe("beta-channel");
    expect(channelForType("rc")).toBe("release-candidate");
    expect(channelForType("release")).toBe("announcements");
  });
});

describe("buildAnnounceEmbed", () => {
  it("builds a beta embed with the beta title and teal color", () => {
    const data = buildAnnounceEmbed("beta", "2.3.0-beta.1", "- Feature A").toJSON();
    expect(data.title).toContain("Beta 2.3.0-beta.1");
    expect(data.color).toBe(0x4aa6b0);
    expect(data.description).toContain("beta-feedback");
    expect(data.description).toContain("releases/tag/v2.3.0-beta.1");
  });

  it("builds an RC embed with the candidate title and green color", () => {
    const data = buildAnnounceEmbed("rc", "2.3.0-rc.1", "- Feature A").toJSON();
    expect(data.title).toContain("Release Candidate 2.3.0-rc.1");
    expect(data.color).toBe(0x7bc47f);
    expect(data.description).toContain("Feature A");
    expect(data.description).toContain("beta-feedback");
    expect(data.description).toContain("releases/tag/v2.3.0-rc.1");
  });

  it("builds a release embed with the release title and brand color", () => {
    const data = buildAnnounceEmbed("release", "2.3.0", "- Feature A").toJSON();
    expect(data.title).toContain("TravStats 2.3.0 released");
    expect(data.color).toBe(0xf0a947);
    expect(data.description).toContain("releases/tag/v2.3.0");
  });

  it("falls back to a placeholder when there are no notes", () => {
    const data = buildAnnounceEmbed("release", "2.3.0", null).toJSON();
    expect(data.description).toContain("See the changelog for details.");
  });

  it("truncates very long notes", () => {
    const long = "x".repeat(5000);
    const data = buildAnnounceEmbed("release", "2.3.0", long).toJSON();
    expect((data.description ?? "").length).toBeLessThan(4096);
    expect(data.description).toContain("…");
  });
});

describe("runAnnounce --dry-run", () => {
  it("never logs in and never posts when dryRun is true", async () => {
    // A stub client: if runAnnounce honours dryRun it must touch neither
    // `login` nor `once` (the latter is where the send lives).
    const login = vi.fn();
    const once = vi.fn();
    const client = { login, once, destroy: vi.fn() } as unknown as Client;

    await runAnnounce(client, "token", "guild", "beta", "2.3.0-beta.9", "- notes", true);

    expect(login).not.toHaveBeenCalled();
    expect(once).not.toHaveBeenCalled();
  });
});

describe("runAnnounce promise settlement (non-dry-run)", () => {
  // discord.js's `login()` resolves on the raw gateway READY dispatch, which
  // fires BEFORE `clientReady` — the event the actual posting work runs on.
  // These tests pin down that runAnnounce's returned promise tracks
  // `clientReady` (+ destroy), not the earlier `login()` resolution — see the
  // runAnnounce docstring in src/announce.ts.

  it("does not settle just because login() resolved — only once clientReady's work finishes", async () => {
    // `once` intentionally never invokes the captured handler, emulating a
    // client that logged in but never received `clientReady`. If runAnnounce
    // settled as soon as login() resolves (the bug), this promise would have
    // fulfilled by the time the microtask queue drains below.
    const login = vi.fn().mockResolvedValue("token");
    const once = vi.fn();
    const destroy = vi.fn().mockResolvedValue(undefined);
    const client = { login, once, destroy } as unknown as Client;

    let settled = false;
    void runAnnounce(client, "token", "guild", "beta", "1.0.0", null, false).then(() => {
      settled = true;
    });

    // Flush several microtask turns — enough for login()'s promise (and any
    // reasonable chain hanging off it) to resolve.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(login).toHaveBeenCalledWith("token");
    expect(settled).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("rejects instead of hanging forever when login() rejects (e.g. a bad token)", async () => {
    const login = vi.fn().mockRejectedValue(new Error("bad token"));
    const once = vi.fn();
    const client = { login, once, destroy: vi.fn() } as unknown as Client;

    await expect(
      runAnnounce(client, "bad-token", "guild", "beta", "1.0.0", null, false),
    ).rejects.toThrow("bad token");
  });
});
