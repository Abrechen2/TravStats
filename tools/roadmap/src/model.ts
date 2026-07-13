import type { Resolved } from "./cache.js";
import type { DeploymentState } from "./collectors/deployments.js";
import type { DiscordMessage, DiscordState } from "./collectors/discord.js";
import type { GitState } from "./collectors/git.js";
import type { GithubPr, GithubState } from "./collectors/github.js";
import {
  BACKLOG,
  UNASSIGNED,
  type ItemStatus,
  type RoadmapConfig,
  type SourceType,
  type VersionState,
} from "./types.js";

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
  /**
   * True only for a github-sourced card whose live issue was found AND is
   * closed. A closed issue is shipped work: it resolves its title normally
   * but must never re-enter the promote decision (promoting cannot "close"
   * an issue that is already closed) or the Unassigned anti-drift column.
   */
  readonly closed: boolean;
}

export interface Column {
  readonly versionId: string;
  readonly state: VersionState | null;
  readonly branch: string | null;
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
    // The live issue resolves its title whether it is open OR closed — a
    // shipped issue is not a ghost. Only a ref in NEITHER list (deleted, or
    // a typo'd config) falls back to an explicit placeholder.
    const title =
      item.source.type === "github"
        ? (live?.title ?? `#${item.source.ref ?? "?"} (nicht auf GitHub gefunden)`)
        : (item.title ?? `${item.id} (kein Titel konfiguriert)`);
    const closed = item.source.type === "github" && live !== undefined && live.state === "closed";
    return {
      id: item.id,
      title,
      source: item.source.type,
      sourceRef: item.source.ref ?? null,
      url: live?.url ?? item.source.url ?? null,
      status: item.status,
      branch: item.branch ?? null,
      notes: item.notes ?? null,
      closed,
    };
  };

  const declared: Column[] = config.versions.map((version) => ({
    versionId: version.id,
    state: version.state,
    branch: version.branch ?? null,
    note: version.note ?? null,
    cards: config.items.filter((i) => i.version === version.id).map(toCard),
  }));

  const backlog: Column = {
    versionId: BACKLOG,
    state: null,
    branch: null,
    note: null,
    cards: config.items.filter((i) => i.version === BACKLOG).map(toCard),
  };

  // The anti-drift column: every OPEN issue that no item claims. A closed
  // issue nobody tracked is not a gap — it shipped without ceremony, not
  // without oversight.
  const claimed = new Set(
    config.items.map((i) => i.source.ref).filter((ref): ref is number => ref !== undefined)
  );
  const unassigned: Column = {
    versionId: UNASSIGNED,
    state: null,
    branch: null,
    note: null,
    cards: issues
      .filter((issue) => issue.state === "open" && !claimed.has(issue.number))
      .map((issue) => ({
        id: `gh-${issue.number}`,
        title: issue.title,
        source: "github" as const,
        sourceRef: issue.number,
        url: issue.url,
        status: "planned" as const,
        branch: null,
        notes: null,
        closed: false,
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
      headline: `Merge-Entscheidung offen: ${version.id} (${version.branch})`,
      detail: [
        `${branch.ahead} Commits vor main`,
        riders.length > 0
          ? `trägt ${riders.length} Item(s): ${riders.map((c) => c.title).join(", ")}`
          : "keine Items zugeordnet — Tracking-Lücke",
      ],
    });
  }

  // 2. Fixed work waiting on a release — the thing that had 13 issues hostage.
  //    Only a DECLARED version is a release that can be promoted; fixed work
  //    parked in the synthetic backlog/unassigned columns is a config
  //    mistake and gets a warning naming the item(s), not a fake decision.
  //    A card whose GitHub issue is already closed is shipped work — it must
  //    never re-enter the promote decision, since promoting cannot "close"
  //    an issue that is already closed.
  const declaredVersionIds = new Set(input.config.versions.map((v) => v.id));
  for (const column of columns) {
    const waiting = column.cards.filter((c) => c.status === "fixed-awaiting-release" && !c.closed);
    if (waiting.length === 0) continue;

    if (declaredVersionIds.has(column.versionId)) {
      decisions.push({
        kind: "promote",
        headline: `${column.versionId} freigeben — schließt ${waiting.length} Issue(s)`,
        // Print the reference once: the fallback title for an unresolved
        // ref already begins with "#<ref>" — prepending it again duplicates
        // it ("#178 #178 (...)").  Only prepend when the title does not
        // already carry it.
        detail: waiting.map((c) => {
          if (c.sourceRef === null) return c.title;
          const ref = `#${c.sourceRef}`;
          return c.title.startsWith(ref) ? c.title : `${ref} ${c.title}`;
        }),
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
      headline: `${blocked.length} Item(s) blockiert`,
      detail: blocked.map((c) => c.title),
    });
  }

  // 4. Feedback nobody has sorted yet. Never list every message inline — a
  //    per-channel count is enough to see that triage is needed; the
  //    verbatim messages live in the Discord digest section instead.
  const untriaged = input.discord.data?.untriaged ?? [];
  if (untriaged.length > 0) {
    const byChannel = new Map<string, number>();
    for (const message of untriaged) {
      byChannel.set(message.channel, (byChannel.get(message.channel) ?? 0) + 1);
    }
    decisions.push({
      kind: "triage",
      headline: `${untriaged.length} untriagierte Discord-Nachricht(en)`,
      detail: [...byChannel.entries()].map(
        ([channel, count]) => `#${channel} · ${count} Nachricht(en)`
      ),
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
