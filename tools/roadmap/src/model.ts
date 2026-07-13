import type { Resolved } from "./cache.js";
import type { DeploymentState } from "./collectors/deployments.js";
import type { DiscordMessage, DiscordState } from "./collectors/discord.js";
import type { GitState } from "./collectors/git.js";
import type { GithubPr, GithubState } from "./collectors/github.js";
import { BACKLOG, UNASSIGNED, type ItemStatus, type RoadmapConfig, type SourceType, type VersionState } from "./types.js";

export interface ModelInput {
  readonly config: RoadmapConfig;
  readonly generatedAt: string;
  readonly git: Resolved<GitState>;
  readonly github: Resolved<GithubState>;
  readonly deployments: Resolved<DeploymentState>;
  readonly discord: Resolved<DiscordState>;
}

export interface Card {
  readonly id: string;
  readonly title: string;
  readonly source: SourceType;
  readonly sourceRef: number | null;
  readonly url: string | null;
  readonly status: ItemStatus;
  readonly branch: string | null;
  readonly notes: string | null;
}

export interface Column {
  readonly versionId: string;
  readonly state: VersionState | null;
  readonly note: string | null;
  readonly cards: readonly Card[];
}

export interface Decision {
  readonly kind: "merge" | "promote" | "blocked" | "triage";
  readonly headline: string;
  readonly detail: readonly string[];
}

export interface InstanceTile {
  readonly id: string;
  readonly label: string;
  readonly role: string;
  readonly running: string | null;
  readonly expected: string | null;
  readonly mismatch: boolean;
  readonly error: string | null;
}

export interface ViewModel {
  readonly generatedAt: string;
  readonly decisions: readonly Decision[];
  readonly instances: readonly InstanceTile[];
  readonly columns: readonly Column[];
  readonly untriaged: readonly DiscordMessage[];
  readonly branches: GitState["branches"];
  readonly dependabotPrs: readonly GithubPr[];
  readonly warnings: readonly string[];
}

function warningsFor(input: ModelInput): string[] {
  const sections: ReadonlyArray<[string, Resolved<unknown>]> = [
    ["Git", input.git],
    ["GitHub", input.github],
    ["Instances", input.deployments],
    ["Discord", input.discord],
  ];

  return sections.flatMap(([label, section]) => {
    if (section.reason === null) return [];
    return section.staleSince === null
      ? [`${label}: unavailable (${section.reason}) — no cached state, section is empty`]
      : [`${label}: ${section.reason} — showing cached state from ${section.staleSince}`];
  });
}

function buildColumns(input: ModelInput): Column[] {
  const { config } = input;
  const issues = input.github.data?.issues ?? [];
  const issueByNumber = new Map(issues.map((i) => [i.number, i]));

  const toCard = (item: RoadmapConfig["items"][number]): Card => {
    const live = item.source.ref !== undefined ? issueByNumber.get(item.source.ref) : undefined;
    return {
      id: item.id,
      // A github title is ALWAYS live. If the issue is gone (closed, deleted),
      // say so rather than inventing a title from the config.
      title: item.title ?? live?.title ?? `#${item.source.ref ?? "?"} (not among the open issues)`,
      source: item.source.type,
      sourceRef: item.source.ref ?? null,
      url: live?.url ?? item.source.url ?? null,
      status: item.status,
      branch: item.branch ?? null,
      notes: item.notes ?? null,
    };
  };

  const declared: Column[] = config.versions.map((version) => ({
    versionId: version.id,
    state: version.state,
    note: version.note ?? null,
    cards: config.items.filter((i) => i.version === version.id).map(toCard),
  }));

  const backlog: Column = {
    versionId: BACKLOG,
    state: null,
    note: null,
    cards: config.items.filter((i) => i.version === BACKLOG).map(toCard),
  };

  // The anti-drift column: every open issue that no item claims.
  const claimed = new Set(
    config.items.map((i) => i.source.ref).filter((ref): ref is number => ref !== undefined)
  );
  const unassigned: Column = {
    versionId: UNASSIGNED,
    state: null,
    note: null,
    cards: issues
      .filter((issue) => !claimed.has(issue.number))
      .map((issue) => ({
        id: `gh-${issue.number}`,
        title: issue.title,
        source: "github" as const,
        sourceRef: issue.number,
        url: issue.url,
        status: "planned" as const,
        branch: null,
        notes: null,
      })),
  };

  return [...declared, backlog, unassigned];
}

function buildDecisions(input: ModelInput, columns: readonly Column[]): Decision[] {
  const decisions: Decision[] = [];
  const branches = input.git.data?.branches ?? [];

  // 1. A finished line that is not in main is a decision, not a task.
  for (const version of input.config.versions) {
    if (version.state !== "awaiting-merge" || version.branch === undefined) continue;
    const branch = branches.find((b) => b.name === version.branch);
    if (!branch || branch.ahead === 0) continue;

    const riders = columns.find((c) => c.versionId === version.id)?.cards ?? [];
    decisions.push({
      kind: "merge",
      headline: `Merge decision open: ${version.id} (${version.branch})`,
      detail: [
        `${branch.ahead} commits ahead of main`,
        riders.length > 0
          ? `carries ${riders.length} item(s): ${riders.map((c) => c.title).join(", ")}`
          : "carries no tracked items",
      ],
    });
  }

  // 2. Fixed work waiting on a release — the thing that had 13 issues hostage.
  const waitingByVersion = new Map<string, Card[]>();
  for (const column of columns) {
    const waiting = column.cards.filter((c) => c.status === "fixed-awaiting-release");
    if (waiting.length > 0) waitingByVersion.set(column.versionId, waiting);
  }
  for (const [versionId, waiting] of waitingByVersion) {
    decisions.push({
      kind: "promote",
      headline: `Promote ${versionId} — closes ${waiting.length} issue(s)`,
      detail: waiting.map((c) => `${c.sourceRef !== null ? `#${c.sourceRef} ` : ""}${c.title}`),
    });
  }

  // 3. Anything explicitly blocked names its blocker.
  const blocked = columns.flatMap((c) => c.cards).filter((c) => c.status === "blocked");
  if (blocked.length > 0) {
    decisions.push({
      kind: "blocked",
      headline: `${blocked.length} item(s) blocked`,
      detail: blocked.map((c) => c.title),
    });
  }

  // 4. Feedback nobody has sorted yet.
  const untriaged = input.discord.data?.untriaged ?? [];
  if (untriaged.length > 0) {
    decisions.push({
      kind: "triage",
      headline: `${untriaged.length} untriaged Discord message(s)`,
      detail: untriaged.map((m) => `#${m.channel} · ${m.author} · ${m.timestamp}`),
    });
  }

  return decisions;
}

function buildInstances(input: ModelInput): InstanceTile[] {
  const running = input.deployments.data?.running ?? [];

  return input.config.instances.map((instance) => {
    const live = running.find((r) => r.id === instance.id);
    const image = live?.image ?? null;
    return {
      id: instance.id,
      label: instance.label,
      role: instance.role,
      running: image,
      expected: instance.expect ?? null,
      mismatch: instance.expect !== undefined && image !== null && image !== instance.expect,
      error: live?.error ?? null,
    };
  });
}

/** Pure: the whole judgement of the tool, and therefore the whole test surface. */
export function buildViewModel(input: ModelInput): ViewModel {
  const columns = buildColumns(input);

  return {
    generatedAt: input.generatedAt,
    decisions: buildDecisions(input, columns),
    instances: buildInstances(input),
    columns,
    untriaged: input.discord.data?.untriaged ?? [],
    branches: input.git.data?.branches ?? [],
    dependabotPrs: input.github.data?.dependabotPrs ?? [],
    warnings: warningsFor(input),
  };
}
