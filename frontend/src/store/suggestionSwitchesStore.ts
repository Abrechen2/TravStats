import { create } from "zustand";
import { serializedSetting } from "./serializedSetting";
import { useCapabilitiesEpochStore } from "./capabilitiesEpochStore";

/**
 * The account's inbox suggestion switches (forgejo#306): whether the
 * Posteingang offers trip suggestions and Dawarich stay suggestions at all.
 *
 * Its own store rather than more fields on `settingsStore`, which sits at the
 * 800-line limit; `loadRemoteSettings` hands it the same response it reads,
 * the way it feeds `profileZoneStore`. The navigation badge, the inbox and the
 * settings card all subscribe here, so a flip shows everywhere without a
 * reload — the badge re-counts and the tab appears or goes at once.
 *
 * Both default to on, the server's default: until the settings arrive the
 * inbox asks as it always did, and the server, which reads the switch itself,
 * answers a switched-off kind empty without computing it.
 *
 * Not persisted: the server holds the truth, re-learned per session.
 *
 * `tripRecording` (forgejo#316) rides along for the same reason the inbox
 * switches live here: it is an account switch `GET /settings` answers, and
 * `settingsStore` has no room for it. So do the settings prototype rows of
 * forgejo#321 — the new-trip colour, whether sea days count, live tracking —
 * for the same two reasons, and the rail import's two remembered defaults
 * for local-transit legs (2026-10-23). And the account's TravPlan switch
 * (2026-10-27), which also has the navigation re-read capabilities once saved.
 */
interface SuggestionSwitchesState {
  trips: boolean;
  stays: boolean;
  /** Immich photos as evidence for a stay's place (forgejo#305); server default on. */
  stayImmichEvidence: boolean;
  /** A model classifies a stay's kind of place (forgejo#305); server default off. */
  stayLlmPlaceClassification: boolean;
  /** Whether the server stores the app's trip positions (forgejo#316); server default on. */
  tripRecording: boolean;
  /** The colour of a new trip (forgejo#321); null = automatic, the server default. */
  tripDefaultColor: string | null;
  /** Whether sea days count in the cruise day total (forgejo#321); server default on. */
  cruiseSeaDaysCounted: boolean;
  /** Whether the server takes the app's flight recording (forgejo#321); server default on. */
  liveTracking: boolean;
  /** What a bahn.de import starts U-Bahn/tram legs as; server default `skip`. */
  railImportLocalTransit: RailImportLocalTransit;
  /** What a bahn.de import starts bus legs as; server default `skip`. */
  railImportBus: RailImportBus;
  /** Whether this account uses TravPlan (owner, 2026-10-27); server default off. */
  travPlan: boolean;
  /** What `GET /settings` said; anything that is not a boolean keeps the default. */
  noteRemote: (remote: unknown) => void;
  setTrips: (enabled: boolean) => void;
  setStays: (enabled: boolean) => void;
  setStayImmichEvidence: (enabled: boolean) => void;
  setStayLlmPlaceClassification: (enabled: boolean) => void;
  setTripRecording: (enabled: boolean) => void;
  setTripDefaultColor: (color: string | null) => void;
  setCruiseSeaDaysCounted: (counted: boolean) => void;
  setLiveTracking: (enabled: boolean) => void;
  setRailImportLocalTransit: (value: RailImportLocalTransit) => void;
  setRailImportBus: (value: RailImportBus) => void;
  setTravPlan: (enabled: boolean) => void;
}

export type RailImportLocalTransit = "skip" | "rail";
export type RailImportBus = "skip" | "bus";

/** `railImport.<key>` when it is one of `words`; anything else is no answer. */
const wordIn = <T extends string>(
  group: unknown,
  key: string,
  words: readonly T[]
): T | undefined => {
  const value = (group as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" && (words as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
};

const booleanIn = (group: unknown, key: string): boolean | undefined => {
  const value = (group as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "boolean" ? value : undefined;
};
const enabledIn = (group: unknown): boolean | undefined => booleanIn(group, "enabled");
/** `tripDefaults.color`: a string, or null for automatic; anything else is no answer. */
const colorIn = (group: unknown): string | null | undefined => {
  if (group === null || typeof group !== "object" || !("color" in group)) return undefined;
  const value = (group as { color: unknown }).color;
  return typeof value === "string" || value === null ? value : undefined;
};

export const useSuggestionSwitchesStore = create<SuggestionSwitchesState>((set, get) => ({
  trips: true,
  stays: true,
  stayImmichEvidence: true,
  stayLlmPlaceClassification: false,
  tripRecording: true,
  tripDefaultColor: null,
  cruiseSeaDaysCounted: true,
  liveTracking: true,
  railImportLocalTransit: "skip",
  railImportBus: "skip",
  travPlan: false,
  noteRemote: (remote) => {
    const body = remote as {
      tripSuggestions?: unknown;
      staySuggestions?: unknown;
      tripRecording?: unknown;
      tripDefaults?: unknown;
      cruiseSeaDays?: unknown;
      liveTracking?: unknown;
      railImport?: unknown;
      travPlan?: unknown;
    } | null;
    const stay = body?.staySuggestions;
    // `null` is an answer (automatic), not an absence: only `undefined` keeps
    // the old value, or a previous account's colour would survive a login.
    const color = colorIn(body?.tripDefaults);
    set({
      trips: enabledIn(body?.tripSuggestions) ?? get().trips,
      stays: enabledIn(stay) ?? get().stays,
      stayImmichEvidence: booleanIn(stay, "immichEvidence") ?? get().stayImmichEvidence,
      stayLlmPlaceClassification:
        booleanIn(stay, "llmPlaceClassification") ?? get().stayLlmPlaceClassification,
      tripRecording: enabledIn(body?.tripRecording) ?? get().tripRecording,
      tripDefaultColor: color === undefined ? get().tripDefaultColor : color,
      cruiseSeaDaysCounted: booleanIn(body?.cruiseSeaDays, "counted") ?? get().cruiseSeaDaysCounted,
      liveTracking: enabledIn(body?.liveTracking) ?? get().liveTracking,
      railImportLocalTransit:
        wordIn(body?.railImport, "localTransit", ["skip", "rail"] as const) ??
        get().railImportLocalTransit,
      railImportBus:
        wordIn(body?.railImport, "bus", ["skip", "bus"] as const) ?? get().railImportBus,
      travPlan: enabledIn(body?.travPlan) ?? get().travPlan,
    });
  },
  setTrips: serializedSetting({
    payload: (enabled: boolean) => ({ tripSuggestions: { enabled } }),
    current: () => get().trips,
    apply: (trips) => set({ trips }),
    what: "trip suggestions switch",
  }),
  setStays: serializedSetting({
    payload: (enabled: boolean) => ({ staySuggestions: { enabled } }),
    current: () => get().stays,
    apply: (stays) => set({ stays }),
    what: "stay suggestions switch",
  }),
  setStayImmichEvidence: serializedSetting({
    payload: (immichEvidence: boolean) => ({ staySuggestions: { immichEvidence } }),
    current: () => get().stayImmichEvidence,
    apply: (stayImmichEvidence) => set({ stayImmichEvidence }),
    what: "stay Immich evidence switch",
  }),
  setStayLlmPlaceClassification: serializedSetting({
    payload: (llmPlaceClassification: boolean) => ({ staySuggestions: { llmPlaceClassification } }),
    current: () => get().stayLlmPlaceClassification,
    apply: (stayLlmPlaceClassification) => set({ stayLlmPlaceClassification }),
    what: "stay place classification switch",
  }),
  setTripRecording: serializedSetting({
    payload: (enabled: boolean) => ({ tripRecording: { enabled } }),
    current: () => get().tripRecording,
    apply: (tripRecording) => set({ tripRecording }),
    what: "trip recording switch",
  }),
  setTripDefaultColor: serializedSetting({
    payload: (color: string | null) => ({ tripDefaults: { color } }),
    current: () => get().tripDefaultColor,
    apply: (tripDefaultColor) => set({ tripDefaultColor }),
    what: "new trip colour",
  }),
  setCruiseSeaDaysCounted: serializedSetting({
    payload: (counted: boolean) => ({ cruiseSeaDays: { counted } }),
    current: () => get().cruiseSeaDaysCounted,
    apply: (cruiseSeaDaysCounted) => set({ cruiseSeaDaysCounted }),
    what: "sea days switch",
  }),
  setLiveTracking: serializedSetting({
    payload: (enabled: boolean) => ({ liveTracking: { enabled } }),
    current: () => get().liveTracking,
    apply: (liveTracking) => set({ liveTracking }),
    what: "live tracking switch",
  }),
  setRailImportLocalTransit: serializedSetting({
    payload: (localTransit: RailImportLocalTransit) => ({ railImport: { localTransit } }),
    current: () => get().railImportLocalTransit,
    apply: (railImportLocalTransit) => set({ railImportLocalTransit }),
    what: "rail import U-Bahn/tram default",
  }),
  setRailImportBus: serializedSetting({
    payload: (bus: RailImportBus) => ({ railImport: { bus } }),
    current: () => get().railImportBus,
    apply: (railImportBus) => set({ railImportBus }),
    what: "rail import bus default",
  }),
  setTravPlan: serializedSetting({
    payload: (enabled: boolean) => ({ travPlan: { enabled } }),
    current: () => get().travPlan,
    apply: (travPlan) => set({ travPlan }),
    what: "TravPlan switch",
    saved: () => useCapabilitiesEpochStore.getState().bump("travPlan"),
  }),
}));
