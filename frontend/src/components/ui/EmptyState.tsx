import type { ReactNode } from "react";
import { alpha } from "./tokens";

/**
 * Four kinds, and none of them is red.
 *
 * The rule the Companion states and the web adopts: an empty or waiting state
 * is never an error, and offline is a waiting state. Painting "no flights yet"
 * or "not connected" in `bad` tells a user something is broken when nothing is.
 *
 * - `nothing` — neutral, one primary call to action, required. An empty state
 *   with no way out is a dead end.
 * - `degraded` — `warn`, a retry, and the log in mono. Something answered
 *   badly and the user may act on it.
 * - `pending` — `info`. It has not happened YET; the copy is future tense.
 * - `unpaired` — neutral with a `warn` banner. Nothing is wrong; a step is
 *   missing.
 */
export type EmptyStateKind = "nothing" | "degraded" | "pending" | "unpaired";

const KIND_COLOR: Record<EmptyStateKind, string> = {
  nothing: "var(--ts-muted)",
  degraded: "var(--ts-warn)",
  pending: "var(--ts-info)",
  unpaired: "var(--ts-muted)",
};

interface EmptyStateProps {
  kind?: EmptyStateKind;
  icon?: ReactNode;
  title: string;
  /** First person for failure, future tense for waiting. */
  description?: ReactNode;
  /** The one way out. Required for `nothing`, by the rule above. */
  action?: ReactNode;
  /** Machine detail — a provider name, a status line. Mono, and only here. */
  log?: string;
  /** The `unpaired` banner: what step is missing, in one sentence. */
  banner?: ReactNode;
}

export default function EmptyState({
  kind = "nothing",
  icon,
  title,
  description,
  action,
  log,
  banner,
}: EmptyStateProps): JSX.Element {
  const color = KIND_COLOR[kind];
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{
        gap: "var(--ts-space-lg)",
        padding: "var(--ts-space-xxl) var(--ts-space-xl)",
      }}
      data-empty-kind={kind}
    >
      {banner ? (
        <div
          className="t-caption"
          style={{
            width: "100%",
            color: "var(--ts-warn)",
            background: alpha("var(--ts-warn)", 12),
            border: `1px solid ${alpha("var(--ts-warn)", 45)}`,
            borderRadius: "var(--ts-radius-button)",
            padding: "var(--ts-space-md) var(--ts-space-lg)",
          }}
        >
          {banner}
        </div>
      ) : null}

      {icon ? (
        <span
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--ts-radius-tile)",
            background: "var(--ts-tile)",
            border: "1px solid var(--ts-border)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color,
          }}
        >
          {icon}
        </span>
      ) : null}

      <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)", maxWidth: 420 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>
          {title}
        </span>
        {description ? <span className="t-caption">{description}</span> : null}
      </div>

      {log ? (
        <code
          className="t-meta-mono"
          style={{
            display: "block",
            maxWidth: "100%",
            overflowX: "auto",
            background: "var(--ts-surface2)",
            border: "1px solid var(--ts-border)",
            borderRadius: "var(--ts-radius-button)",
            padding: "var(--ts-space-sm) var(--ts-space-md)",
            textAlign: "left",
          }}
        >
          {log}
        </code>
      ) : null}

      {action}
    </div>
  );
}
