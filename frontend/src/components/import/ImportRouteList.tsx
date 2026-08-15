import type { JSX, ReactNode } from "react";
import type { ImportRoute } from "./types";

/**
 * The rows of the "what do you have?" chooser, shared by every domain.
 *
 * This lives on its own so the flight dialog and `<DomainImportPanel>` render
 * the SAME rows instead of two look-alikes drifting apart — flights had their
 * own hand-built version of this list, which is why the wording and the layout
 * differed from every other domain.
 *
 * Presentational only: it owns no state and performs no import. A route either
 * carries an action button or renders its own body (a search field, a drop
 * zone); the list does not care which.
 */

interface ImportRouteRowProps {
  icon: string;
  title: string;
  description: string;
  primary?: boolean;
  actionLabel?: string;
  onSelect?: () => void;
  /** Inline body under the description — a field, a drop zone, a hint. */
  children?: ReactNode;
}

export function ImportRouteRow({
  icon,
  title,
  description,
  primary = false,
  actionLabel,
  onSelect,
  children,
}: ImportRouteRowProps): JSX.Element {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        primary
          ? "border-(--accent)/45 bg-(--accent-soft)"
          : "border-border bg-(--bg-elevated)"
      }`}
    >
      <span aria-hidden="true" className="w-5 shrink-0 text-center text-base leading-6">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-(--text-primary)">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-(--text-muted)">{description}</p>
        {children}
      </div>
      {actionLabel && onSelect && (
        <button
          type="button"
          onClick={onSelect}
          className={`shrink-0 self-center whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold ${
            primary
              ? "bg-(--accent) text-black hover:bg-(--accent-dim)"
              : "border border-border text-(--text-primary) hover:border-(--accent)"
          }`}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

interface ImportRouteListProps {
  routes: ImportRoute[];
}

/** Renders every route that is not hidden, in the order the adapter gave. */
export function ImportRouteList({ routes }: ImportRouteListProps): JSX.Element {
  return (
    <>
      {routes
        .filter((r) => !r.hidden)
        .map((r) => (
          <ImportRouteRow
            key={r.id}
            icon={r.icon}
            title={r.title}
            description={r.description}
            primary={r.primary}
            actionLabel={r.actionLabel}
            onSelect={r.onSelect}
          >
            {r.render?.()}
          </ImportRouteRow>
        ))}
    </>
  );
}

interface ManualFooterProps {
  label: string;
  onSelect: () => void;
}

/**
 * Typing everything by hand is always available and never the headline — a
 * quiet link under a divider, not a row competing with the routes that fill
 * things in for you.
 */
export function ImportManualFooter({ label, onSelect }: ManualFooterProps): JSX.Element {
  return (
    <div className="mt-3 border-t border-border pt-3 text-center">
      <button
        type="button"
        onClick={onSelect}
        className="text-xs text-(--text-muted) underline underline-offset-4 hover:text-(--text-primary)"
      >
        {label}
      </button>
    </div>
  );
}
