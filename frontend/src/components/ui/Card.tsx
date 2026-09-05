import type { HTMLAttributes, ReactNode } from "react";

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Drops the inner padding for a card that holds a table or a map. */
  flush?: boolean;
}

/**
 * "Schatten sparsam": a card has none. It has a hairline.
 *
 * Three surfaces, one rule each, and no fourth. `Card` is the ordinary
 * container (`surface`, radius 16); `Tile` is what sits INSIDE a card (`tile`,
 * radius 14) — a monogram box, a KPI cell; `HeroCard` is the gradient one at
 * the top of a detail page (radius 18). Nothing else is a container.
 */
export function Card({ children, flush = false, style, ...rest }: SurfaceProps): JSX.Element {
  return (
    <div
      style={{
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        padding: flush ? 0 : "var(--ts-space-xxl)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Tile({ children, flush = false, style, ...rest }: SurfaceProps): JSX.Element {
  return (
    <div
      style={{
        background: "var(--ts-tile)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-tile)",
        padding: flush ? 0 : "var(--ts-space-lg)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function HeroCard({ children, flush = false, style, ...rest }: SurfaceProps): JSX.Element {
  return (
    <div
      style={{
        background: "var(--ts-hero-gradient)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card-lg)",
        padding: flush ? 0 : "var(--ts-space-xxl)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * A surface that knows little and says so.
 *
 * Not an empty state — the difference matters. An empty state means "there is
 * nothing here yet, and here is what to do about it". A sparse card means "this
 * exists, we just know two facts about it", and dressing that up as a full card
 * promises detail that is not coming.
 */
export function SparseCard({ children, style, ...rest }: SurfaceProps): JSX.Element {
  return (
    <div
      style={{
        background: "var(--ts-surface2)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        padding: "var(--ts-space-lg)",
        fontSize: 12,
        color: "var(--ts-muted)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
