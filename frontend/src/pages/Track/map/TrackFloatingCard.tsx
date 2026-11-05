import { useId } from "react";
import type { CSSProperties, JSX, ReactNode } from "react";
import { token } from "../../../components/ui/tokens";

/** A floating card over the map: the app's surface, slightly see-through, never over the controls' hit area. */
export const floatingStyle: CSSProperties = {
  background: "color-mix(in srgb, var(--ts-surface) 94%, transparent)",
  border: `1px solid ${token("border")}`,
  borderRadius: token("radius-card"),
};

/**
 * One collapsible card of the map stage (TravTrack web redesign, 2026-11-05):
 * a header button that folds the body away. Collapsed it is a pill with the
 * title (and an optional summary), so a narrow screen keeps the map free.
 * The parent owns the state — a selection may open a collapsed card.
 */
export default function TrackFloatingCard({
  title,
  summary,
  collapsed,
  onToggle,
  coarse,
  testId,
  children,
  style,
  bodyStyle,
}: {
  title: string;
  /** Shown beside the title while collapsed. */
  summary?: string;
  collapsed: boolean;
  onToggle: () => void;
  coarse: boolean;
  testId?: string;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}): JSX.Element {
  const bodyId = useId();
  return (
    <section
      data-testid={testId}
      data-collapsed={collapsed}
      aria-label={title}
      className="flex min-h-0 flex-col"
      style={{ ...floatingStyle, ...style }}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={onToggle}
        className="t-card-title flex w-full items-center gap-2 text-left"
        style={{
          minHeight: coarse ? 44 : 40,
          padding: "0 14px",
          background: "transparent",
          border: "none",
          color: token("text"),
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        {collapsed && summary && (
          <span className="t-caption tabular-nums" style={{ fontWeight: 400 }}>
            {summary}
          </span>
        )}
        <span aria-hidden className="ml-auto">
          {collapsed ? "▸" : "▾"}
        </span>
      </button>
      <div
        id={bodyId}
        hidden={collapsed}
        className="flex min-h-0 flex-col gap-3 overflow-y-auto"
        style={{ padding: "0 14px 14px", ...bodyStyle }}
      >
        {!collapsed && children}
      </div>
    </section>
  );
}
