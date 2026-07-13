/**
 * A collector never throws; it reports a typed failure so one dead source
 * cannot cost the whole page.
 */
export type CollectorResult<T> = { ok: true; data: T } | { ok: false; reason: string };

export type ItemStatus =
  | "planned"
  | "active"
  | "blocked"
  | "parked"
  | "fixed-awaiting-release"
  | "done";

export type SourceType = "github" | "discord" | "audit" | "owner";

export type VersionState = "released" | "rc" | "awaiting-merge" | "planned";

export interface ItemSource {
  readonly type: SourceType;
  /** GitHub issue number. Present only when type === "github". */
  readonly ref?: number;
  /** Jump link for a discord source. */
  readonly url?: string;
}

export interface RoadmapItem {
  readonly id: string;
  readonly source: ItemSource;
  /** Required for every source EXCEPT github, whose title is read live. */
  readonly title?: string;
  /** A version id, or "backlog". */
  readonly version: string;
  readonly status: ItemStatus;
  readonly branch?: string;
  readonly notes?: string;
}

export interface RoadmapVersion {
  readonly id: string;
  readonly state: VersionState;
  readonly branch?: string;
  readonly note?: string;
}

export interface InstanceDef {
  readonly id: string;
  readonly label: string;
  readonly role: string;
  readonly node: string;
  readonly ct: number;
  readonly container: string;
  /** The version the roadmap believes runs here; a mismatch is surfaced. */
  readonly expect?: string;
}

export interface DiscordWatermark {
  readonly channel: string;
  readonly triagedUpTo: string;
}

export interface RoadmapConfig {
  readonly instances: readonly InstanceDef[];
  readonly versions: readonly RoadmapVersion[];
  readonly items: readonly RoadmapItem[];
  readonly discord: readonly DiscordWatermark[];
}

/** The synthetic column id for open issues that no item claims. */
export const UNASSIGNED = "unassigned";
/** The synthetic column id for items with no target version. */
export const BACKLOG = "backlog";
