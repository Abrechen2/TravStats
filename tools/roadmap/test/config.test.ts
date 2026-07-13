import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const VALID = `
instances:
  - id: prod
    label: Prod
    role: production
    node: 192.0.2.1
    ct: 100
    container: TravStats
discord:
  - channel: dev-talk
    triagedUpTo: "2026-07-12T16:42:30Z"
versions:
  - id: "2.4.0"
    state: rc
    branch: main
items:
  - id: gh-197
    source: { type: github, ref: 197 }
    version: "2.4.0"
    status: fixed-awaiting-release
`;

describe("loadConfig", () => {
  it("parses a valid config", () => {
    const config = loadConfig(VALID);
    expect(config.items[0].id).toBe("gh-197");
    expect(config.versions[0].state).toBe("rc");
    expect(config.instances[0].ct).toBe(100);
  });

  it("rejects a github item that carries a hand-written title", () => {
    const yaml = VALID.replace(
      "    status: fixed-awaiting-release",
      '    status: fixed-awaiting-release\n    title: "Booking number missing"'
    );
    expect(() => loadConfig(yaml)).toThrow(/title/i);
  });

  it("requires a title on a non-github item", () => {
    const yaml = `${VALID}
  - id: discord-nav
    source: { type: discord }
    version: "2.4.0"
    status: planned
`;
    expect(() => loadConfig(yaml)).toThrow(/title/i);
  });

  it("rejects an unknown status", () => {
    const yaml = VALID.replace("status: fixed-awaiting-release", "status: nearly-done");
    expect(() => loadConfig(yaml)).toThrow(/status/i);
  });

  it("rejects an item pointing at a version that does not exist", () => {
    const yaml = VALID.replace('version: "2.4.0"\n    status', 'version: "9.9.9"\n    status');
    expect(() => loadConfig(yaml)).toThrow(/9\.9\.9/);
  });

  it("accepts an item in the backlog column without a declared version", () => {
    const yaml = VALID.replace('version: "2.4.0"\n    status', "version: backlog\n    status");
    expect(loadConfig(yaml).items[0].version).toBe("backlog");
  });

  it("rejects a source.url with a javascript: scheme, naming the offending item", () => {
    const yaml = `${VALID}
  - id: discord-nav
    source: { type: discord, url: "javascript:alert(document.cookie)" }
    title: "Nav proposal"
    version: "2.4.0"
    status: planned
`;
    expect(() => loadConfig(yaml)).toThrow(/discord-nav/);
    expect(() => loadConfig(yaml)).toThrow(/http/i);
  });

  it("rejects a source.url with a data: scheme", () => {
    const yaml = `${VALID}
  - id: discord-nav
    source: { type: discord, url: "data:text/html,<script>alert(1)</script>" }
    title: "Nav proposal"
    version: "2.4.0"
    status: planned
`;
    expect(() => loadConfig(yaml)).toThrow(/discord-nav/);
  });

  it("accepts a source.url with an https scheme", () => {
    const yaml = `${VALID}
  - id: discord-nav
    source: { type: discord, url: "https://discord.com/channels/1/2/3" }
    title: "Nav proposal"
    version: "2.4.0"
    status: planned
`;
    expect(loadConfig(yaml).items[1].id).toBe("discord-nav");
  });
});
