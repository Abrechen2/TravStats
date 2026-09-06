import type { ReactNode } from "react";
import NavigationBar from "../NavigationBar";
import PageTransition from "../PageTransition";

/**
 * The three container widths, and nothing else.
 *
 * The Companion caps content at 480dp because a phone is a column. A desktop
 * page is not, and a table of flights needs the width — so the web keeps three
 * names instead of one number (DESIGN_SYSTEM.md §4.2). The ten different
 * `max-w-*` values the app carries today collapse into these.
 */
export type ShellWidth = "reading" | "list" | "full";

const MAX_WIDTH: Record<ShellWidth, string | undefined> = {
  /** settings, forms, detail pages, text */
  reading: "var(--ts-width-reading)",
  /** tables, lists, dashboards */
  list: "var(--ts-width-list)",
  /** maps and the globe — the page IS the surface */
  full: undefined,
};

interface AppShellProps {
  children: ReactNode;
  /** Defaults to `list`: most pages are a list or a dashboard. */
  width?: ShellWidth;
  /**
   * Skips the centred `<main>` padding for pages that paint to the edge
   * themselves (a map fills its own frame). Only meaningful with `full`.
   */
  bleed?: boolean;
  /**
   * The page IS the viewport: exactly 100vh, nothing scrolls at this level,
   * and the child fills whatever the navigation leaves.
   *
   * The dashboard needs this and nothing else does — a map has to know its
   * own height, and `min-h-screen` with a scrolling body cannot give it one.
   * It is a third shape rather than a third `width` because it answers a
   * different question: `width` says how wide the content may be, this says
   * who owns the height.
   */
  viewport?: boolean;
  /** Extra classes on the inner container, for a page-level grid. */
  className?: string;
}

/**
 * Navigation plus a container, in one place.
 *
 * Every page used to import `NavigationBar` itself and then pick its own
 * `max-w-*`, which is why no two pages agreed on how wide a page is. A page
 * asks for a width by name now; it never imports the navigation and never
 * writes a pixel measure.
 */
export default function AppShell({
  children,
  width = "list",
  bleed = false,
  viewport = false,
  className,
}: AppShellProps): JSX.Element {
  const maxWidth = MAX_WIDTH[width];

  // A viewport page is not wrapped in the page transition: the transition
  // animates a transform, and a transformed ancestor makes every `position:
  // fixed` descendant position against IT instead of the window — which is
  // what a map's floating chrome relies on.
  const frame = (
    <div
      className={viewport ? "flex flex-col" : "min-h-screen"}
      style={{ background: "var(--ts-bg)", height: viewport ? "100vh" : undefined }}
    >
      <NavigationBar />
      <main
        className={className}
        style={{
          maxWidth,
          width: "100%",
          margin: "0 auto",
          minHeight: 0,
          flex: viewport ? 1 : undefined,
          position: viewport ? "relative" : undefined,
          overflow: viewport ? "hidden" : undefined,
          // Screen padding is a token (24). The bottom is deliberately deeper
          // than the top so the last card never sits flush against the fold.
          padding: bleed || viewport ? 0 : "var(--ts-space-xl) var(--ts-space-screen-padding) 80px",
        }}
      >
        {children}
      </main>
    </div>
  );

  return viewport ? frame : <PageTransition>{frame}</PageTransition>;
}
