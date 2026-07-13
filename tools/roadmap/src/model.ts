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
    // A github card's title is ALWAYS live, even if a (stale) config title is
    // present — the config loader is supposed to reject one, but the model
    // must not trust that and must not let a config title win regardless.
    // If the issue is gone from the open set (closed, deleted), say so rather
    // than inventing a title from the config.
    const title =
      item.source.type === "github"
        ? (live?.title ?? `#${item.source.ref ?? "?"} (not among the open issues)`)
        : (item.title ?? `${item.id} (no title configured)`);
    return {
      id: item.id,
      title,
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

interface DecisionsResult {
  readonly decisions: Decision[];
  readonly warnings: string[];
}

function buildDecisions(input: ModelInput, columns: readonly Column[]): DecisionsResult {
  const decisions: Decision[] = [];
  const warnings: string[] = [];
  const branches = input.git.data?.branches ?? [];
  // Only a genuinely successful collection run can be trusted to say a branch
  // is absent. A failed run (data === null) already gets the generic Git
  // warning from warningsFor — reporting the same absence again here would
  // be a duplicate, and a stale cached branch list is not proof of anything.
  const gitCollectionSucceeded = input.git.reason === null;

  // 1. A finished line that is not in main is a decision, not a task —
  //    UNLESS the declared branch does not exist at all, which is a config
  //    problem (renamed/deleted/typo'd branch) that must never fail silently.
  for (const version of input.config.versions) {
    if (version.state !== "awaiting-merge" || version.branch === undefined) continue;
    const branch = branches.find((b) => b.name === version.branch);

    if (!branch) {
      if (gitCollectionSucceeded) {
        warnings.push(
          `${version.id}: declared branch "${version.branch}" is awaiting-merge but does not exist in git — the roadmap config is stale`
        );
      }
      continue;
    }
    if (branch.ahead === 0) continue;

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
  //    Only a DECLARED version is a release that can be promoted; fixed work
  //    parked in the synthetic backlog/unassigned columns is a config
  //    mistake and gets a warning naming the item(s), not a fake decision.
  const declaredVersionIds = new Set(input.config.versions.map((v) => v.id));
  for (const column of columns) {
    const waiting = column.cards.filter((c) => c.status === "fixed-awaiting-release");
    if (waiting.length === 0) continue;

    if (declaredVersionIds.has(column.versionId)) {
      decisions.push({
        kind: "promote",
        headline: `Promote ${column.versionId} — closes ${waiting.length} issue(s)`,
        detail: waiting.map((c) => `${c.sourceRef !== null ? `#${c.sourceRef} ` : ""}${c.title}`),
      });
    } else {
      warnings.push(
        `${waiting.map((c) => c.id).join(", ")}: marked fixed-awaiting-release but has no declared release version ("${column.versionId}") — this is a config mistake, not a release to promote`
      );
    }
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

  return { decisions, warnings };
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
  const { decisions, warnings: decisionWarnings } = buildDecisions(input, columns);

  return {
    generatedAt: input.generatedAt,
    decisions,
    instances: buildInstances(input),
    columns,
    untriaged: input.discord.data?.untriaged ?? [],
    branches: input.git.data?.branches ?? [],
    dependabotPrs: input.github.data?.dependabotPrs ?? [],
    warnings: [...warningsFor(input), ...decisionWarnings],
  };
}
