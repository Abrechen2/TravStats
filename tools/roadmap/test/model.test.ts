import { describe, expect, it } from "vitest";
import { buildViewModel, type ModelInput } from "../src/model.js";
import type { RoadmapConfig } from "../src/types.js";

const CONFIG: RoadmapConfig = {
  instances: [
    {
      id: "prod",
      label: "Prod",
      role: "production",
      node: "10.0.0.1",
      ct: 100,
      container: "TravStats",
      expect: "2.3.1",
    },
  ],
  discord: [{ channel: "dev-talk", triagedUpTo: "2026-07-12T12:00:00Z" }],
  versions: [
    { id: "2.4.0", state: "rc", branch: "main" },
    { id: "2.5.0", state: "awaiting-merge", branch: "dev/immich-albums" },
  ],
  items: [
    { id: "gh-197", source: { type: "github", ref: 197 }, version: "2.4.0", status: "fixed-awaiting-release" },
    { id: "gh-186", source: { type: "github", ref: 186 }, version: "2.4.0", status: "fixed-awaiting-release" },
    { id: "gh-154", source: { type: "github", ref: 154 }, version: "2.5.0", status: "done" },
    { id: "d-nav", source: { type: "discord" }, title: "Nav submenus", version: "backlog", status: "planned" },
  ],
};

function input(overrides: Partial<ModelInput> = {}): ModelInput {
  return {
    config: CONFIG,
    generatedAt: "2026-07-13T12:00:00Z",
    git: {
      data: { branches: [{ name: "dev/immich-albums", head: "9f8397fa", ahead: 81, worktree: null }] },
      staleSince: null,
      reason: null,
    },
    github: {
      data: {
        issues: [
          { number: 197, title: "Booking number missing", labels: ["bug"], author: "alex", url: "u197" },
          { number: 186, title: "Profile picture lost", labels: ["bug"], author: "alex", url: "u186" },
          { number: 154, title: "Link Immich album", labels: [], author: "alex", url: "u154" },
          { number: 200, title: "Actual and scheduled times", labels: [], author: "alex", url: "u200" },
        ],
        dependabotPrs: [],
      },
      staleSince: null,
      reason: null,
    },
    deployments: { data: { running: [{ id: "prod", image: "2.3.1", error: null }] }, staleSince: null, reason: null },
    discord: { data: { untriaged: [] }, staleSince: null, reason: null },
    ...overrides,
  };
}

describe("buildViewModel", () => {
  it("puts an open issue that no item claims into the Unassigned column", () => {
    const vm = buildViewModel(input());
    const unassigned = vm.columns.find((c) => c.versionId === "unassigned");
    expect(unassigned?.cards.map((c) => c.sourceRef)).toEqual([200]);
  });

  it("reads a github card's title live and never from the config", () => {
    const vm = buildViewModel(input());
    const card = vm.columns.flatMap((c) => c.cards).find((c) => c.sourceRef === 197);
    expect(card?.title).toBe("Booking number missing");
  });

  it("derives a promote decision naming how many issues it closes", () => {
    const vm = buildViewModel(input());
    const promote = vm.decisions.find((d) => d.kind === "promote");
    expect(promote?.headline).toContain("2.4.0");
    expect(promote?.headline).toContain("2");
  });

  it("derives a merge decision for an awaiting-merge version whose branch is ahead", () => {
    const vm = buildViewModel(input());
    const merge = vm.decisions.find((d) => d.kind === "merge");
    expect(merge?.headline).toContain("2.5.0");
    expect(merge?.detail.join(" ")).toContain("81");
  });

  it("does NOT derive a merge decision when the branch is already merged", () => {
    const vm = buildViewModel(
      input({
        git: {
          data: { branches: [{ name: "dev/immich-albums", head: "9f8397fa", ahead: 0, worktree: null }] },
          staleSince: null,
          reason: null,
        },
      })
    );
    expect(vm.decisions.find((d) => d.kind === "merge")).toBeUndefined();
  });

  it("derives a triage decision when discord has untriaged messages", () => {
    const vm = buildViewModel(
      input({
        discord: {
          data: {
            untriaged: [
              { channel: "dev-talk", author: "alex", timestamp: "2026-07-12T14:20:00Z", content: "six asks", url: "u" },
            ],
          },
          staleSince: null,
          reason: null,
        },
      })
    );
    expect(vm.decisions.find((d) => d.kind === "triage")?.headline).toContain("1");
  });

  it("flags an instance whose running version differs from the expected one", () => {
    const vm = buildViewModel(
      input({
        deployments: { data: { running: [{ id: "prod", image: "2.2.0", error: null }] }, staleSince: null, reason: null },
      })
    );
    expect(vm.instances[0].mismatch).toBe(true);
  });

  it("marks a section as stale instead of dropping it when its collector failed", () => {
    const vm = buildViewModel(
      input({
        deployments: {
          data: { running: [{ id: "prod", image: "2.3.1", error: null }] },
          staleSince: "2026-07-13T09:00:00Z",
          reason: "ssh timeout",
        },
      })
    );
    expect(vm.warnings.some((w) => w.includes("ssh timeout"))).toBe(true);
    expect(vm.instances).toHaveLength(1);
  });

  it("says so explicitly when there is nothing to decide", () => {
    const bare: RoadmapConfig = { ...CONFIG, items: [], versions: [], discord: [] };
    const vm = buildViewModel({ ...input(), config: bare });
    expect(vm.decisions).toHaveLength(0);
  });
});
