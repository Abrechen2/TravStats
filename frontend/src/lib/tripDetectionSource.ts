/**
 * The i18n key (`trips:detectBanner.sources.<key>`) of a trip-detection
 * source. The banner once printed the implementation names — "PNR-Cluster ·
 * Home-Loop · Continuity" — on a German page (CT106 audit B11), and the review
 * dialog kept doing it in its chip as "HOME-LOOP" (browser acceptance
 * 2026-09-26). One mapping for both, so they cannot drift apart again.
 */
export function detectionSourceKey(src: string): string {
  switch (src) {
    case "pnr":
      return "pnr";
    case "home_loop":
      return "homeLoop";
    case "continuity":
      return "continuity";
    default:
      return "other";
  }
}
