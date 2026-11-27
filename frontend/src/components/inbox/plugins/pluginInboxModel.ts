import type {
  MaintenanceIssue,
  MaintenanceNotice,
  MaintenanceRow,
  SuggestionPlugin,
} from "../../../lib/api/suggestionPlugins";

/**
 * The inbox's "Plugins" tab (owner 2026-11-26): each plugin's maintenance proposals and its notices
 * as one list, sortable by severity, date or "has a stop proposal" and filterable per plugin.
 *
 * Only what asks the owner to act (owner, rc.48): a row whose proposals carry evidence from his
 * own stops, and error notices. A row that is merely imprecise, with geocoder guesses only, is not
 * an inbox item — on prod that was all 50 cached rows plus 100 warning notices, 53 of them about
 * a row already listed, i.e. ~150 entries of which none came from a stop. Those rows stay in
 * Settings → plugin → "Standorte pflegen". Each archive row is ONE item: its geocoder and stop
 * proposals and every notice about it fold into it.
 */
export type Severity = "error" | "warning" | "info";
export type PluginSort = "severity" | "date" | "stop";

export type PluginEntry =
  | {
      kind: "row";
      key: string;
      plugin: SuggestionPlugin;
      row: MaintenanceRow;
      /** Notices the plugin raised about this row, folded into its item. */
      notices: MaintenanceNotice[];
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

const worse = (a: Severity, b: Severity): Severity => (RANK[b] < RANK[a] ? b : a);
const hasStopProposal = (row: MaintenanceRow) => row.proposals.some((p) => p.source === "stop");

export function entriesOf(
  plugin: SuggestionPlugin,
  rows: readonly MaintenanceRow[],
  notices: readonly MaintenanceNotice[]
): PluginEntry[] {
  const noticesOf = new Map<string, MaintenanceNotice[]>();
  for (const n of notices) {
    if (n.rowId === undefined) continue;
    const id = String(n.rowId);
    noticesOf.set(id, [...(noticesOf.get(id) ?? []), n]);
  }
  const rowIds = new Set(rows.map((r) => String(r.rowId)));
  const ignoredIds = new Set(rows.filter((r) => r.ignored).map((r) => String(r.rowId)));

  const rowEntries = rows
    .filter((row) => !row.ignored)
    .flatMap((row): PluginEntry[] => {
      const own = noticesOf.get(String(row.rowId)) ?? [];
      const hasStop = hasStopProposal(row);
      const hasError = own.some((n) => n.severity === "error");
      if (!hasStop && !hasError) return [];
      return [
        {
          kind: "row",
          key: `${plugin.id}:row:${row.rowId}`,
          plugin,
          row,
          notices: own,
          severity: own.reduce<Severity>((w, n) => worse(w, n.severity), rowSeverity(row)),
          date: rowDate(row),
          hasStop,
        },
      ];
    });

  // An error notice with no row of its own on this page (or about the whole plugin) stands alone,
  // once per code and row.
  const seen = new Set<string>();
  const noticeEntries = notices.flatMap((notice): PluginEntry[] => {
    if (notice.severity !== "error") return [];
    const rowId = notice.rowId === undefined ? null : String(notice.rowId);
    if (rowId !== null && (rowIds.has(rowId) || ignoredIds.has(rowId))) return [];
    const key = `${plugin.id}:notice:${notice.code}:${rowId ?? "-"}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        kind: "notice",
        key,
        plugin,
        notice,
        severity: notice.severity,
        date: notice.at ?? null,
        hasStop: false,
      },
    ];
  });
  return [...rowEntries, ...noticeEntries];
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
