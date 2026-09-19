import type { JSX } from "react";

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

/**
 * Companions on a detail page: one row per person with an initials mark, as
 * round 4 draws the "Mitreisende" section. A comma list ran the names into
 * one wrapped line the eye had to split again.
 */
export default function PeopleList({ names }: { names: readonly string[] }): JSX.Element {
  return (
    <ul className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {names.map((name) => (
        <li key={name} className="flex items-center" style={{ gap: "var(--ts-space-md)" }}>
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
            {initials(name)}
          </span>
          <span style={{ fontSize: 14, color: "var(--ts-text-bright)" }}>{name}</span>
        </li>
      ))}
    </ul>
  );
}
