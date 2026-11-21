import type { ReactNode } from "react";
import NavigationBar from "../NavigationBar";
import PageTransition from "../PageTransition";

/**
 * One width: the window's.
 *
 * Until 2026-11-20 the shell offered four named widths (reading 720, list
 * 1200, table 1440, full) so a form could stay a column and a logbook could
 * grow. In practice that meant no two neighbouring pages shared an edge: at
 * 1366px and up settings, trips and tours were narrow centred columns while a
 * logbook table ran edge to edge. The owner reversed it ("Es muss bei allen
 * Seiten der UI die volle Breite des Fensters genutzt werden"): every page
 * fills the window and keeps the same side gutter (`--ts-space-screen-padding`).
 *
 * A page that wants a readable line length caps the PARAGRAPH (about 80ch),
 * never the page. Centred auth cards (login, setup, reset) are dialogs, not
 * pages, and stay outside the shell.
 */

interface AppShellProps {
  children: ReactNode;
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
 * never imports the navigation and never caps its own width.
 */
export default function AppShell({
  children,
  bleed = false,
  viewport = false,
  className,
}: AppShellProps): JSX.Element {
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
          width: "100%",
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
