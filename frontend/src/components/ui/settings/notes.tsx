import type { JSX, ReactNode } from "react";
import { alpha } from "../tokens";

interface JumpProps {
  label: string;
  onJump: () => void;
}

/** A text-weight action inside a row: "Erneut versuchen", "Verbinden ›". */
export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-caption"
      style={{
        background: "none",
        border: 0,
        padding: 0,
        minHeight: 24,
        color: "var(--ts-accent)",
        fontWeight: 700,
        cursor: "pointer",
        textDecoration: "underline",
      }}
    >
      {children}
    </button>
  );
}

/**
 * B10: why a setting does not take effect, and where to fix it. A reason that
 * only an admin can lift ("Der Admin hat keine KI freigegeben.") passes no
 * `jump` — sending the user to a page they cannot change is a dead end.
 */
export function Dependency({
  id,
  reason,
  jump,
}: {
  id?: string;
  reason: ReactNode;
  jump?: JumpProps;
}): JSX.Element {
  return (
    <p
      id={id}
      className="t-caption flex flex-wrap items-center"
      data-dependency=""
      style={{ gap: "var(--ts-space-sm)", margin: 0 }}
    >
      <span>{reason}</span>
      {jump ? <LinkButton onClick={jump.onJump}>{jump.label} ›</LinkButton> : null}
    </p>
  );
}

/** The line under a field: `bad` text, first person, never a toast. */
export function ErrorLine({ id, children }: { id?: string; children: ReactNode }): JSX.Element {
  return (
    <p id={id} role="alert" className="t-caption" style={{ color: "var(--ts-bad)", margin: 0 }}>
      {children}
    </p>
  );
}

/** B15: a required value is missing — `warn`, not `bad`, nothing was typed wrong. */
export function RequiredLine({ id, children }: { id?: string; children: ReactNode }): JSX.Element {
  return (
    <p
      id={id}
      data-required-warning=""
      className="t-caption"
      style={{
        color: "var(--ts-warn)",
        margin: 0,
        borderLeft: `2px solid ${alpha("var(--ts-warn)", 45)}`,
        paddingLeft: "var(--ts-space-sm)",
      }}
    >
      {children}
    </p>
  );
}
