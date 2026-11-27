import type {
  MaintenanceIssue,
  MaintenanceNotice,
  MaintenanceRow,
  SuggestionPlugin,
} from "../../../lib/api/suggestionPlugins";

/**
 * The inbox's "Plugins" tab (owner 2026-11-26): each plugin's maintenance proposals and its notices
 * as one list, sortable by severity, date or "has a stop proposal" and filterable per plugin.
 */
export type Severity = "error" | "warning" | "info";
export type PluginSort = "severity" | "date" | "stop";

export type PluginEntry =
  | {
      kind: "row";
      key: string;
      plugin: SuggestionPlugin;
      row: MaintenanceRow;
      severity: Severity;
      date: string | null;
      hasStop: boolean;
    }
  | {
      kind: "notice";
      key: string;
      plugin: SuggestionPlugin;
      notice: MaintenanceNotice;
      severity: Severity;
      date: string | null;
      hasStop: boolean;
    };

const ISSUE_SEVERITY: Record<MaintenanceIssue, Severity> = {
  noCoordinates: "error",
  coordsMismatch: "warning",
  lowPrecision: "info",
  noStreet: "info",
};
const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function rowSeverity(row: MaintenanceRow): Severity {
  return row.issues
    .map((i) => ISSUE_SEVERITY[i] ?? "info")
    .reduce<Severity>((worst, s) => (RANK[s] < RANK[worst] ? s : worst), "info");
}

/** The latest stop a proposal names: the row's date; null when none names one. */
function rowDate(row: MaintenanceRow): string | null {
  const dates = row.proposals
    .map((p) => p.evidence?.stopStart ?? null)
    .filter((d): d is string => !!d)
    .sort();
  return dates[dates.length - 1] ?? null;
}

export function entriesOf(
  plugin: SuggestionPlugin,
  rows: readonly MaintenanceRow[],
  notices: readonly MaintenanceNotice[]
): PluginEntry[] {
  return [
    ...rows
      .filter((row) => !row.ignored)
      .map((row): PluginEntry => ({
        kind: "row",
        key: `${plugin.id}:row:${row.rowId}`,
        plugin,
        row,
        severity: rowSeverity(row),
        date: rowDate(row),
        hasStop: row.proposals.some((p) => p.source === "stop"),
      })),
    ...notices.map((notice, i): PluginEntry => ({
      kind: "notice",
      key: `${plugin.id}:notice:${notice.code}:${notice.rowId ?? i}`,
      plugin,
      notice,
      severity: notice.severity,
      date: notice.at ?? null,
      hasStop: false,
    })),
  ];
}

/** A new array; ties fall back to severity, then the newest date, then the name. */
export function sortEntries(entries: readonly PluginEntry[], by: PluginSort): PluginEntry[] {
  const bySeverity = (a: PluginEntry, b: PluginEntry) => RANK[a.severity] - RANK[b.severity];
  const byDate = (a: PluginEntry, b: PluginEntry) => (b.date ?? "").localeCompare(a.date ?? "");
  const byStop = (a: PluginEntry, b: PluginEntry) => Number(b.hasStop) - Number(a.hasStop);
  const name = (e: PluginEntry) => (e.kind === "row" ? e.row.name : (e.notice.name ?? ""));
  const order =
    by === "date"
      ? [byDate, bySeverity]
      : by === "stop"
        ? [byStop, bySeverity, byDate]
        : [bySeverity, byDate];
  return [...entries].sort(
    (a, b) => order.reduce((r, cmp) => r || cmp(a, b), 0) || name(a).localeCompare(name(b))
  );
}
