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
    {
      id: "gh-197",
      source: { type: "github", ref: 197 },
      version: "2.4.0",
      status: "fixed-awaiting-release",
    },
    {
      id: "gh-186",
      source: { type: "github", ref: 186 },
      version: "2.4.0",
      status: "fixed-awaiting-release",
    },
    { id: "gh-154", source: { type: "github", ref: 154 }, version: "2.5.0", status: "done" },
    {
      id: "d-nav",
      source: { type: "discord" },
      title: "Nav submenus",
      version: "backlog",
      status: "planned",
    },
  ],
};

function input(overrides: Partial<ModelInput> = {}): ModelInput {
  return {
    config: CONFIG,
    generatedAt: "2026-07-13T12:00:00Z",
    git: {
      data: {
        branches: [{ name: "dev/immich-albums", head: "9f8397fa", ahead: 81, worktree: null }],
      },
      staleSince: null,
      reason: null,
    },
    github: {
      data: {
        issues: [
          {
            number: 197,
            title: "Booking number missing",
            state: "open",
            labels: ["bug"],
            author: "alex",
            url: "u197",
          },
          {
            number: 186,
            title: "Profile picture lost",
            state: "open",
            labels: ["bug"],
            author: "alex",
            url: "u186",
          },
          {
            number: 154,
            title: "Link Immich album",
            state: "open",
            labels: [],
            author: "alex",
            url: "u154",
          },
          {
            number: 200,
            title: "Actual and scheduled times",
            state: "open",
            labels: [],
            author: "alex",
            url: "u200",
          },
        ],
        dependabotPrs: [],
      },
      staleSince: null,
      reason: null,
    },
    deployments: {
      data: { running: [{ id: "prod", image: "2.3.1", error: null }] },
      staleSince: null,
      reason: null,
    },
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
          data: {
            branches: [{ name: "dev/immich-albums", head: "9f8397fa", ahead: 0, worktree: null }],
          },
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
              {
                channel: "dev-talk",
                author: "alex",
                timestamp: "2026-07-12T14:20:00Z",
                content: "six asks",
                url: "u",
              },
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
        deployments: {
          data: { running: [{ id: "prod", image: "2.2.0", error: null }] },
          staleSince: null,
          reason: null,
        },
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

  it("produces no decisions when there is nothing to decide", () => {
    const bare: RoadmapConfig = { ...CONFIG, items: [], versions: [], discord: [] };
    const vm = buildViewModel({ ...input(), config: bare });
    expect(vm.decisions).toHaveLength(0);
  });

  it("warns when an awaiting-merge version's declared branch is missing from a successful git collection", () => {
    const vm = buildViewModel(
      input({
        git: {
          data: { branches: [{ name: "main", head: "abc123", ahead: 0, worktree: null }] },
          staleSince: null,
          reason: null,
        },
      })
    );
    expect(
      vm.warnings.some(
        (w) =>
          w.includes("2.5.0") &&
          w.includes("dev/immich-albums") &&
          w.toLowerCase().includes("stale")
      )
    ).toBe(true);
    expect(vm.decisions.find((d) => d.kind === "merge")).toBeUndefined();
  });

  it("does not double-report a missing branch when the git collector itself failed", () => {
    const vm = buildViewModel(
      input({
        git: { data: null, staleSince: null, reason: "git ls-remote timeout" },
      })
    );
    expect(vm.warnings.some((w) => w.includes("git ls-remote timeout"))).toBe(true);
    expect(vm.warnings.some((w) => w.includes("declared branch"))).toBe(false);
    expect(vm.decisions.find((d) => d.kind === "merge")).toBeUndefined();
  });

  it("never derives a promote decision for the synthetic backlog column", () => {
    const withBacklogFix: RoadmapConfig = {
      ...CONFIG,
      items: [
        ...CONFIG.items,
        {
          id: "gh-999",
          source: { type: "github", ref: 999 },
          title: "Stray backlog fix",
          version: "backlog",
          status: "fixed-awaiting-release",
        },
      ],
    };
    const vm = buildViewModel(input({ config: withBacklogFix }));
    expect(
      vm.decisions.find((d) => d.kind === "promote" && d.headline.includes("backlog"))
    ).toBeUndefined();
    expect(vm.warnings.some((w) => w.includes("gh-999"))).toBe(true);
  });

  it("prefers the live issue title over a stale config title for a github-sourced item", () => {
    const withStaleTitle: RoadmapConfig = {
      ...CONFIG,
      items: CONFIG.items.map((item) =>
        item.id === "gh-197" ? { ...item, title: "Old stale title from config" } : item
      ),
    };
    const vm = buildViewModel(input({ config: withStaleTitle }));
    const card = vm.columns.flatMap((c) => c.cards).find((c) => c.sourceRef === 197);
    expect(card?.title).toBe("Booking number missing");
  });

  // --- Bug A: a shipped (closed) issue must resolve, not render as a ghost ---

  it("resolves a closed issue's title normally instead of rendering it as a ghost", () => {
    const config: RoadmapConfig = {
      ...CONFIG,
      items: [
        ...CONFIG.items,
        { id: "gh-178", source: { type: "github", ref: 178 }, version: "2.4.0", status: "done" },
      ],
    };
    const base = input();
    const vm = buildViewModel(
      input({
        config,
        github: {
          data: {
            issues: [
              ...(base.github.data?.issues ?? []),
              {
                number: 178,
                title: "Promote 2.4.0",
                state: "closed",
                labels: [],
                author: "alex",
                url: "u178",
              },
            ],
            dependabotPrs: [],
          },
          staleSince: null,
          reason: null,
        },
      })
    );
    const card = vm.columns.flatMap((c) => c.cards).find((c) => c.sourceRef === 178);
    expect(card?.title).toBe("Promote 2.4.0");
    expect(card?.closed).toBe(true);
  });

  it("does not let a closed issue feed the promote decision — promoting cannot close an already-closed issue", () => {
    const config: RoadmapConfig = {
      ...CONFIG,
      versions: [{ id: "2.4.0", state: "rc", branch: "main" }],
      items: [
        {
          id: "gh-178",
          source: { type: "github", ref: 178 },
          version: "2.4.0",
          status: "fixed-awaiting-release",
        },
      ],
    };
    const vm = buildViewModel(
      input({
        config,
        github: {
          data: {
            issues: [
              {
                number: 178,
                title: "Promote 2.4.0",
                state: "closed",
                labels: [],
                author: "alex",
                url: "u178",
              },
            ],
            dependabotPrs: [],
          },
          staleSince: null,
          reason: null,
        },
      })
    );
    expect(vm.decisions.find((d) => d.kind === "promote")).toBeUndefined();
  });

  it("never lands a closed issue in the Unassigned column", () => {
    const config: RoadmapConfig = { ...CONFIG, items: [] };
    const vm = buildViewModel(
      input({
        config,
        github: {
          data: {
            issues: [
              {
                number: 178,
                title: "Promote 2.4.0",
                state: "closed",
                labels: [],
                author: "alex",
                url: "u178",
              },
              {
                number: 200,
                title: "Actual and scheduled times",
                state: "open",
                labels: [],
                author: "alex",
                url: "u200",
              },
            ],
            dependabotPrs: [],
          },
          staleSince: null,
          reason: null,
        },
      })
    );
    const unassigned = vm.columns.find((c) => c.versionId === "unassigned");
    expect(unassigned?.cards.map((c) => c.sourceRef)).toEqual([200]);
  });

  // --- Bug B: the promote decision must print the reference once ---

  it("prints the issue reference once in the promote decision detail, not twice", () => {
    const config: RoadmapConfig = {
      ...CONFIG,
      versions: [{ id: "2.4.0", state: "rc", branch: "main" }],
      items: [
        {
          id: "gh-999",
          source: { type: "github", ref: 999 },
          version: "2.4.0",
          status: "fixed-awaiting-release",
        },
      ],
    };
    const vm = buildViewModel(
      input({
        config,
        github: { data: { issues: [], dependabotPrs: [] }, staleSince: null, reason: null },
      })
    );
    const promote = vm.decisions.find((d) => d.kind === "promote");
    const line = promote?.detail.find((d) => d.includes("999"));
    expect(line?.match(/#999/g)).toHaveLength(1);
  });
});
