import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { alpha, token } from "../../components/ui";

/**
 * Layout for the TravPlan screens — spacing and arrangement only.
 *
 * These replace `travplan.css`, which carried its own button, card, form and
 * badge recipes beside the primitives and redefined the app's global accent
 * tokens on `/plan*`. Nothing here paints: every surface is a primitive from
 * `components/ui`, and every colour below is a token reference.
 */

/** Two columns from tablet width up, one below. */
export function PlanGrid({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      className="grid min-w-0 grid-cols-1 md:grid-cols-2"
      style={{ gap: "var(--ts-space-xl)", marginTop: "var(--ts-space-xl)" }}
    >
      {children}
    </div>
  );
}

export function PlanStack({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      {children}
    </div>
  );
}

export function PlanActions({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center"
      style={{ gap: "var(--ts-space-sm)", margin: "var(--ts-space-md) 0" }}
    >
      {children}
    </div>
  );
}

/** One entry in a list inside a card, separated from the next by a hairline. */
export function PlanRow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      className="flex min-w-0 flex-wrap items-start border-b last:border-b-0"
      style={{
        gap: "var(--ts-space-lg)",
        padding: "var(--ts-space-lg) 0",
        borderColor: "var(--ts-border)",
      }}
    >
      {children}
    </div>
  );
}

/** The part of a row that takes the remaining width. */
export function PlanGrow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-w-0 flex-1" style={{ overflowWrap: "anywhere" }}>
      {children}
    </div>
  );
}

/** A card's heading with its one action on the right. */
export function PlanCardHead({
  title,
  action,
}: {
  title: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div
      className="flex flex-wrap items-start justify-between"
      style={{ gap: "var(--ts-space-lg)", marginBottom: "var(--ts-space-md)" }}
    >
      <h2 className="t-card-title">{title}</h2>
      {action}
    </div>
  );
}

/**
 * A line the page needs the reader to see: `info` for a state (remaining
 * budget, a stale proposal, the mode is switched off), `bad` for a failure.
 * The recipe is the empty-state banner's — tint at 12 %, border at 45 %.
 */
export function PlanNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "bad";
  children: ReactNode;
}): JSX.Element {
  const color = token(tone);
  return (
    <div
      role={tone === "bad" ? "alert" : undefined}
      className="t-body border"
      style={{
        background: alpha(color, 12),
        borderColor: alpha(color, 45),
        borderRadius: "var(--ts-radius-button)",
        padding: "var(--ts-space-md) var(--ts-space-lg)",
        margin: "var(--ts-space-lg) 0",
      }}
    >
      {children}
    </div>
  );
}

type LinkVariant = "primary" | "secondary" | "tab";

/**
 * A navigation that looks like an action.
 *
 * The Button primitive is a button element, and these are navigations: they must stay
 * links, so a middle click opens a new tab and the handover test can read the
 * target. The skins are the Button primitive's, by token. `tab` is the
 * section strip: the current section takes the accent fill, as a chip does.
 */
export function PlanLink({
  to,
  variant = "secondary",
  current = false,
  children,
}: {
  to: string;
  variant?: LinkVariant;
  current?: boolean;
  children: ReactNode;
}): JSX.Element {
  const filled = variant === "primary" || (variant === "tab" && current);
  return (
    <Link
      to={to}
      aria-current={variant === "tab" && current ? "page" : undefined}
      className={`inline-flex items-center justify-center whitespace-nowrap border no-underline ${
        variant === "tab" ? "ts-chip font-semibold" : "ts-button t-card-title"
      }`}
      data-variant={variant === "tab" ? undefined : variant}
      style={{
        minHeight:
          variant === "primary"
            ? "var(--ts-size-button-primary)"
            : variant === "secondary"
              ? "var(--ts-size-button-secondary)"
              : "var(--ts-size-touch-min)",
        padding: "0 var(--ts-space-xl)",
        borderRadius: variant === "tab" ? "var(--ts-radius-chip)" : "var(--ts-radius-button)",
        background: filled ? "var(--ts-accent)" : "transparent",
        color: filled ? "var(--ts-accent-text)" : "var(--ts-text)",
        borderColor: filled ? "var(--ts-accent)" : "var(--ts-border-button)",
      }}
    >
      {children}
    </Link>
  );
}
