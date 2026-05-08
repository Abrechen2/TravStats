import { useState, useMemo } from "react";
import type { PreviewRowEnriched } from "../../lib/api/import";

export interface PreviewModalProps {
  rows: PreviewRowEnriched[];
  summary: { ok: number; problems: number; duplicates: number; unresolvable: number };
  onCommit: (rows: PreviewRowEnriched[]) => void;
  onCancel: () => void;
}

/**
 * Determine whether a date string is the SAFE_DATE sentinel (epoch 0).
 * The server sets depUtc/arrUtc to new Date(0) when a row has hard errors —
 * always check flags.length > 0 before rendering date columns.
 */
function isSafeDate(isoString: string): boolean {
  return isoString.startsWith("1970-01-01");
}

/**
 * Render a date cell safely, returning "—" for flagged (hard-error) rows.
 * Rows with flags have their depUtc/arrUtc set to SAFE_DATE (epoch 0) by the
 * server, so showing the date would display a confusing "1970-01-01" value.
 */
function safeDateDisplay(isoString: string, flags: PreviewRowEnriched["flags"]): string {
  if (flags.length > 0 || isSafeDate(isoString)) {
    return "—";
  }
  return isoString.slice(0, 10);
}

/**
 * Resolve a human-readable status pill for the row, respecting the SAFE_DATE
 * guard: flagged rows should not show "flown"/"scheduled" because the
 * computation is meaningless when the date fields are sentinel values.
 */
function statusDisplay(row: PreviewRowEnriched): string {
  if (row.flags.length > 0) {
    return "—";
  }
  return row.statusDefault;
}

export function PreviewModal({ rows, summary, onCommit, onCancel }: PreviewModalProps): JSX.Element {
  const initialChecked = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const r of rows) {
      const isHardError = r.flags.length > 0;
      m.set(r.sourceRowIndex, !isHardError);
    }
    return m;
  }, [rows]);
  const [checked, setChecked] = useState<Map<number, boolean>>(initialChecked);

  const toggle = (idx: number): void => {
    setChecked((prev) => {
      const next = new Map(prev);
      next.set(idx, !next.get(idx));
      return next;
    });
  };

  const acceptedRows = rows.filter((r) => checked.get(r.sourceRowIndex));

  const submit = (): void => {
    onCommit(acceptedRows);
  };

  return (
    <div role="dialog" aria-modal="true" className="preview-modal">
      <header>
        <h2>Preview import</h2>
        <p>
          {summary.ok} ready · {summary.duplicates} duplicates · {summary.problems} problems
          {summary.unresolvable > 0 && ` · ${summary.unresolvable} unresolvable airports`}
        </p>
      </header>
      <table>
        <thead>
          <tr>
            <th />
            <th>Date</th>
            <th>Route</th>
            <th>Flight</th>
            <th>Status</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isHardError = r.flags.length > 0;
            const isDup = r.dedupeHint !== "none";
            const cls = isHardError ? "row-error" : isDup ? "row-warn" : "row-ok";
            return (
              <tr key={r.sourceRowIndex} className={cls}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`row ${r.sourceRowIndex}`}
                    checked={!!checked.get(r.sourceRowIndex)}
                    disabled={isHardError}
                    onChange={() => toggle(r.sourceRowIndex)}
                  />
                </td>
                {/* SAFE_DATE guard: show "—" for flagged rows — their depUtc/arrUtc
                    are set to epoch 0 by the server and must not be displayed as dates */}
                <td>{safeDateDisplay(r.depUtc, r.flags)}</td>
                <td>
                  {r.fromIata} → {r.toIata}
                </td>
                <td>{r.flightNumberNormalised ?? r.flightNumber ?? "—"}</td>
                <td>{statusDisplay(r)}</td>
                <td>
                  {r.flags.map((f) => (
                    <span key={f} title={f} className="flag-badge flag-error">
                      {f}
                    </span>
                  ))}
                  {isDup && <span className="flag-badge flag-warn">{r.dedupeHint}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <footer>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={submit} disabled={acceptedRows.length === 0}>
          Import {acceptedRows.length} row{acceptedRows.length === 1 ? "" : "s"}
        </button>
      </footer>
    </div>
  );
}
