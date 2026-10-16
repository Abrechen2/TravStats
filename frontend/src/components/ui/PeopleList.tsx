import type { JSX, ReactNode } from "react";

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

/** One person: a name, and on the trip page what is true about them and what can be done. */
export interface PersonRow {
  key: string;
  name: string;
  /** A line under the name — "@username". */
  meta?: ReactNode;
  /** Pills: facts about the person, never actions. */
  badges?: ReactNode;
  /** At most one action, at the end of the row. */
  action?: ReactNode;
}

type PeopleListProps = { names: readonly string[] } | { rows: readonly PersonRow[] };

/**
 * Companions on a detail page: one row per person with an initials mark, as
 * round 4 draws the "Mitreisende" section. A comma list ran the names into
 * one wrapped line the eye had to split again. The trip page passes rows with
 * the sharing state (spec 2026-10-16, D9); every other page passes names.
 */
export default function PeopleList(props: PeopleListProps): JSX.Element {
  const rows: readonly PersonRow[] =
    "rows" in props ? props.rows : props.names.map((name) => ({ key: name, name }));
  return (
    <ul className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {rows.map((row) => (
        <li key={row.key} className="flex items-center" style={{ gap: "var(--ts-space-md)" }}>
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center justify-center"
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: "var(--ts-surface2)",
              fontFamily: "var(--ts-font-mono)",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--ts-text-bright)",
            }}
          >
            {initials(row.name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col" style={{ gap: 2 }}>
            <span style={{ fontSize: 14, color: "var(--ts-text-bright)" }}>{row.name}</span>
            {row.meta && <span className="t-caption">{row.meta}</span>}
            {row.badges && (
              <span className="flex flex-wrap" style={{ gap: 6 }}>
                {row.badges}
              </span>
            )}
          </span>
          {row.action && <span className="shrink-0">{row.action}</span>}
        </li>
      ))}
    </ul>
  );
}
