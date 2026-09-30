import { create } from "zustand";
import {
  FILTER_DOMAIN_ORDER,
  HIDDEN_DOMAINS_STORAGE_KEY,
  parseHiddenDomains,
  serializeHiddenDomains,
  type FilterDomainKey,
} from "../shared/dashboardDomainFilter";

/**
 * The dashboard domain filter's own persisted state — the "Alle" tab's
 * checkbox filter (ClaudeDesign/handoff/2026-09-27-dashboard-domain-
 * filter-rueckmeldung.md), seven rows since `rail` joined on 2026-09-28.
 * Separate from `dashboardFilterStore`, which now holds only the year/time
 * filter: its domain pills were removed the same day, leaving this store the
 * one owner of "is this domain on the map".
 *
 * `hidden` is a viewer preference — wrapped in try/catch throughout, per the
 * artifact-storage convention: a blocked/full localStorage must never break
 * the page, only fail to remember the choice.
 */
function loadInitialHidden(): ReadonlySet<FilterDomainKey> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseHiddenDomains(window.localStorage.getItem(HIDDEN_DOMAINS_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

function persist(hidden: ReadonlySet<FilterDomainKey>): void {
  try {
    window.localStorage.setItem(HIDDEN_DOMAINS_STORAGE_KEY, serializeHiddenDomains(hidden));
  } catch {
    // Private mode / blocked site data — the choice just does not survive a reload.
  }
}

function toggled(
  set: ReadonlySet<FilterDomainKey>,
  key: FilterDomainKey
): ReadonlySet<FilterDomainKey> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

const ALL_HIDDEN = new Set<FilterDomainKey>(FILTER_DOMAIN_ORDER);
const NONE_HIDDEN = new Set<FilterDomainKey>();

function isolated(key: FilterDomainKey): ReadonlySet<FilterDomainKey> {
  return new Set(FILTER_DOMAIN_ORDER.filter((k) => k !== key));
}

interface DashboardDomainFilterState {
  /** The reader's own, persisted hidden set. */
  hidden: ReadonlySet<FilterDomainKey>;
  /**
   * Non-null while viewing a shared link whose `?domains=` differs from the
   * reader's own selection (decision 3): the EFFECTIVE hidden set is this
   * one, not `hidden`, and edits here do not touch storage until
   * `adoptLink`. `null` = no link in view, the reader's own selection rules.
   */
  linkHidden: ReadonlySet<FilterDomainKey> | null;
  toggle(key: FilterDomainKey): void;
  showAll(): void;
  showNone(): void;
  isolate(key: FilterDomainKey): void;
  /**
   * Sets the whole selection at once from the VISIBLE keys.
   *
   * Needed since the filter also drives the route: leaving a single-domain
   * view by ticking a second domain lands on "Alle" with exactly those two
   * visible, which is one state change, not a replay of toggles.
   */
  setVisible(visible: ReadonlySet<FilterDomainKey>): void;
  /** Enters link mode with the sender's VISIBLE set turned into a hidden set. */
  enterLink(visible: ReadonlySet<FilterDomainKey>): void;
  /** "Als meine merken" — persists the link's current state as the reader's own. */
  adoptLink(): void;
  /** The `?domains=` parameter left the URL (or was never there). */
  exitLink(): void;
}

export const useDashboardDomainFilterStore = create<DashboardDomainFilterState>((set) => ({
  hidden: loadInitialHidden(),
  linkHidden: null,
  toggle: (key) =>
    set((s) => {
      if (s.linkHidden !== null) return { linkHidden: toggled(s.linkHidden, key) };
      const hidden = toggled(s.hidden, key);
      persist(hidden);
      return { hidden };
    }),
  showAll: () =>
    set((s) => {
      if (s.linkHidden !== null) return { linkHidden: NONE_HIDDEN };
      persist(NONE_HIDDEN);
      return { hidden: NONE_HIDDEN };
    }),
  showNone: () =>
    set((s) => {
      if (s.linkHidden !== null) return { linkHidden: ALL_HIDDEN };
      persist(ALL_HIDDEN);
      return { hidden: ALL_HIDDEN };
    }),
  setVisible: (visible) =>
    set((s) => {
      const hidden = new Set(FILTER_DOMAIN_ORDER.filter((k) => !visible.has(k)));
      if (s.linkHidden !== null) return { linkHidden: hidden };
      persist(hidden);
      return { hidden };
    }),
  isolate: (key) =>
    set((s) => {
      const hidden = isolated(key);
      if (s.linkHidden !== null) return { linkHidden: hidden };
      persist(hidden);
      return { hidden };
    }),
  enterLink: (visible) =>
    set({ linkHidden: new Set(FILTER_DOMAIN_ORDER.filter((k) => !visible.has(k))) }),
  adoptLink: () =>
    set((s) => {
      const hidden = s.linkHidden ?? s.hidden;
      persist(hidden);
      return { hidden, linkHidden: null };
    }),
  exitLink: () => set({ linkHidden: null }),
}));
