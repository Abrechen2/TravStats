import { create } from "zustand";
import type { EvidenceScopeParams } from "./useEvidence";

/**
 * Out-of-band channel for what a click on a tile knows that the URL should
 * not carry.
 *
 * `?evidence=<kind>:<key>` (`useEvidence.ts`) is deliberately the ONLY
 * evidence state in the URL (design, "The panel") — that is what makes the
 * panel linkable and the back button close it. Two more facts travel WITH a
 * click but must NOT go in the URL:
 *
 * - `scope`: the population the clicking tile is showing right now (its own
 *   year, its own rolling window). A bookmark of a stale scope would ask a
 *   question about the YEAR THE LINK'S OPENER HAD SELECTED, not whatever the
 *   reader who follows it later cares about — and several resolvers 400 on a
 *   scope their tile never shows (`rankingEvidence.ts`, "only supports
 *   period=allTime"). Left `undefined` — a bookmark, or a direct
 *   `setSearchParams` that never called `open()` — the request falls through
 *   to the server's own `allTime` default (`schemas/evidence.ts`).
 * - `renderedValue`: the figure the tile displayed at the moment it was
 *   clicked (design, "The number may have moved since the tile rendered").
 *   It is a snapshot of one render, not a fact worth bookmarking either — a
 *   shared link should ask the panel to measure fresh, not replay someone
 *   else's screen.
 *
 * A plain Zustand store rather than React context or a prop: the trigger
 * (inside one Stats tile) and the panel (mounted once at the page) are
 * siblings with no shared ancestor closer than the page itself, and
 * prop-drilling a scope and a rendered value through every tab and section
 * for the sake of one dialog would spread this concern across files that
 * have nothing to do with evidence.
 */
interface EvidenceOpenState {
  scope: EvidenceScopeParams | undefined;
  renderedValue: number | null | undefined;
  setOpenRequest: (
    scope: EvidenceScopeParams | undefined,
    renderedValue: number | null | undefined
  ) => void;
}

export const useEvidenceOpenStore = create<EvidenceOpenState>((set) => ({
  scope: undefined,
  renderedValue: undefined,
  setOpenRequest: (scope, renderedValue) => set({ scope, renderedValue }),
}));
