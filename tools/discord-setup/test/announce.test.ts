import { describe, it, expect } from "vitest";
import { buildAnnounceEmbed, channelForType } from "../src/announce.js";

describe("channelForType", () => {
  it("routes rc to beta-channel and release to announcements", () => {
    expect(channelForType("rc")).toBe("beta-channel");
    expect(channelForType("release")).toBe("announcements");
  });
});

describe("buildAnnounceEmbed", () => {
  it("builds an RC embed with the testing intro and green color", () => {
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
