import { create } from "zustand";
import { persist } from "zustand/middleware";
import { settingsApi } from "../lib/api";
import { logger } from "../lib/logger";
import { DOMAIN_KEYS, type DomainKey } from "../shared/domains";
import { COUNTRY_TIERS, type CountryTier } from "../types/passport";
import { useAuthStore } from "./authStore";

/**
 * A value off the wire read back as a tier, or null when it is not one.
 *
 * Mirrors `parseCountryTier` on the server, and exists for the same reason: the
 * column behind the setting is plain text, so an older backend, a hand-edited
 * row or a retired vocabulary can all put something here that the counting rule
 * does not know. Null then means "no choice", which returns the account to the
 * instance default — never a rank nothing can match.
 */
const asCountryTier = (value: unknown): CountryTier | null =>
  typeof value === "string" && (COUNTRY_TIERS as readonly string[]).includes(value)
    ? (value as CountryTier)
    : null;

type ThemePreference = "light" | "dark";
type LanguagePreference = "de" | "en";
type DistanceUnit = "kilometers" | "miles" | "nautical_miles";
// "" = no default: the flight form starts unclassified (#256).
type FlightCategory = "" | "business" | "private" | "vacation";
type SeatClass = "" | "economy" | "premium_economy" | "business" | "first";

type FlightReminder = "off" | "24h" | "48h";

type DateFormat = "DD.MM.YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
type TimeFormat = "24h" | "12h";

type FlightStatusDefault = "scheduled" | "flown";

type SettingsUpdater<T> = (updates: Partial<T>) => void;

export interface ProfileSettings {
  username: string;
  email: string;
  profilePicture?: string;
  /**
   * Real name (#241). Like `birthdate` these live on the User row rather than
   * in the settings JSON, because the header reads them from /auth/me — but
   * unlike birthdate they ride along on the ordinary settings payload, so no
   * separate fetch is needed. null means "cleared", undefined "not loaded yet".
   */
  firstName?: string | null;
  lastName?: string | null;
  /**
   * ISO date string (YYYY-MM-DD) or null when unset. User-level field
   * stored on the User row, not in the settings JSON — loaded and saved
   * via the dedicated /settings/profile endpoint. Powers the
   * BIRTHDAY_FLIGHT achievement.
   */
  birthdate?: string | null;
}

export interface DisplaySettings {
  theme: ThemePreference;
  language: LanguagePreference;
  timezone: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
}

export interface UnitsSettings {
  distanceUnit: DistanceUnit;
  // `currency` is GONE from here on purpose (2026-08-23). The app had two
  // currency settings: this one, in the settings JSON, read only by flight
  // surfaces — and `baseCurrency`, a real column, read by lodging, stats and
  // achievements. So the "general" one was domain-specific and the
  // "lodging" one was general, exactly swapped, and three comments in the
  // codebase existed only to warn readers apart. There is one currency now,
  // `baseCurrency`, and it lives under Einheiten & Formate where it always
  // belonged. Removing the field rather than leaving it unread is deliberate:
  // a stale setting that used to control something is a trap.
}

export interface DefaultsSettings {
  flightStatus: FlightStatusDefault;
  seatClass: SeatClass;
  favoriteAirline: string;
  flightCategory: FlightCategory;
}

export interface NotificationSettings {
  flightReminder: FlightReminder;
}

export interface FeaturesSettings {
  enableCostTracking: boolean;
  /**
   * Persist tail number / Mode-S identifiers from flight lookups.
   * Default ON. Off = the form drops aircraftRegistration + Mode-S
   * before submit, so the database column stays NULL even though the
   * lookup returned data. Lets privacy-conscious users keep flight
   * stats without an audit trail of specific airframes they've flown.
   */
  trackAircraftRegistration: boolean;
}

/**
 * Cruise-domain preferences that pre-fill the cruise entry form and
 * shape the cruise map layer. Lives in its own slice so future
 * cruise-specific fields don't mix with flight-specific ones. The
 * same pattern will apply when hotel / POI domains ship — each gets
 * its own nested slice, never flat keys like `cruiseDefaultLine`.
 */
export interface CruiseSettings {
  /** Prefilled in "Neue Kreuzfahrt → Manuell" when the ship field is empty. */
  defaultLine: string;
  /** Prefilled cabin category on new cruises. `null` = no default. */
  defaultCabinType: "inside" | "oceanview" | "balcony" | "suite" | null;
  /** Toggles the cruise arc layer in the dashboard map. */
  showCruiseArcs: boolean;
}

export interface ApiKeyStatus {
  hasKey: boolean;
  isShared: boolean;
  hasAccess: boolean;
}

export interface ApiKeysStatus {
  airlabs: ApiKeyStatus;
  aviationstack: ApiKeyStatus;
  opensky: ApiKeyStatus;
}

export interface SettingsState {
  profile: ProfileSettings;
  display: DisplaySettings;
  units: UnitsSettings;
  defaults: DefaultsSettings;
  notifications: NotificationSettings;
  features: FeaturesSettings;
  cruise: CruiseSettings;
  apiKeys: ApiKeysStatus | null;
  enabledDomains: DomainKey[];
  /**
   * Whether the SERVER has answered about the domains in this session.
   *
   * `enabledDomains` starts as ["flight"] and is persisted, so before the
   * settings fetch returns it holds either that initial value or whatever a
   * previous session left behind. A route guard that reads it too early
   * redirects a domain the user actually has — measured: a direct load of
   * /cruises bounced to / with only ["flight"] persisted, while the server
   * said cruises were on. Deliberately NOT persisted: every session has to
   * wait for its own answer.
   */
  enabledDomainsLoaded: boolean;
  /**
   * The user's currency — the ONE the app has. Every lodging stay is
   * converted into it at the ECB rate for its check-in day, and stats,
   * achievements and flight costs all report in it.
   *
   * It used to share the job with `units.currency`; see UnitsSettings
   * above for why that is gone.
   */
  baseCurrency: string;
  /**
   * Silent trip auto-creation during flight import (`UserSettings.
   * autoCreateTrips`, column-backed, default true). Off = imported flights
   * keep their PNR but no trip/booking is created silently; the explicit
   * "detect trips" action still works.
   */
  autoCreateTrips: boolean;
  /**
   * Which evidence tier the country headline counts from, for THIS user — the
   * user's OWN choice, or `null` when they follow the instance default.
   *
   * The null is a value, not a gap: it means "keep tracking the admin", so an
   * account that never opened the setting still moves when the admin changes
   * their mind. Do not collapse it to `DEFAULT_COUNTRY_TIER` on load.
   */
  countryThreshold: CountryTier | null;
  /**
   * The instance default, mirrored read-only from `GET /settings` — what
   * applies while `countryThreshold` is null. `null` = not loaded yet.
   *
   * Instance state, so it is stripped in `partialize` for the same reason
   * `betaFeaturesEnabled` is: a value cached from a previous session must not
   * decide what the settings page NAMES as the fallback today.
   */
  instanceCountryThreshold: CountryTier | null;
  /**
   * Does this ACCOUNT have any country-day at all — mirrored read-only from
   * `GET /settings`. `null` = not loaded yet.
   *
   * Spec §3.4c: the country-counting control must not offer `transited` where
   * no record can ever carry it, because a choice whose every value produces
   * the same number reads as a bug. Not persisted, for the same reason
   * `instanceCountryThreshold` is not: a cached `true` from a previous session
   * would draw an option this account cannot use.
   */
  hasCountryTracks: boolean | null;
  /**
   * Instance-level beta gate, mirrored read-only from `GET /settings`.
   * `null` = not loaded yet → consumers must treat it as OFF (see
   * `hooks/useBetaFeatures.ts`). It is never persisted or sent back: only an
   * admin can change it, through `PUT /admin/instance-settings`. The ONLY
   * sanctioned writer besides the remote load is `syncBetaFeaturesEnabled`
   * below, which carries the server-confirmed value out of that PUT's
   * response — never a client-side guess.
   */
  betaFeaturesEnabled: boolean | null;
  /**
   * Mirrors the beta gate from a `PUT /admin/instance-settings` RESPONSE into
   * this store, so gated UI (Devices entry, POI tab, trip AI card) reacts
   * without a full page reload. Callers must pass the value the server
   * returned, not the value the admin submitted — the server stays the
   * authority on instance state.
   */
  syncBetaFeaturesEnabled: (enabled: boolean) => void;
  setProfile: SettingsUpdater<ProfileSettings>;
  setDisplay: SettingsUpdater<DisplaySettings>;
  setUnits: SettingsUpdater<UnitsSettings>;
  setDefaults: SettingsUpdater<DefaultsSettings>;
  setNotifications: SettingsUpdater<NotificationSettings>;
  setFeatures: SettingsUpdater<FeaturesSettings>;
  setCruise: SettingsUpdater<CruiseSettings>;
  setApiKeys: (status: ApiKeysStatus) => void;
  setEnabledDomains: (keys: DomainKey[]) => void;
  /**
   * Updates the lodging base currency and persists it immediately (like
   * `setEnabledDomains`) rather than waiting on the `units`-scoped debounce
   * in `useSettingsPage` — that effect only watches `units` and would never
   * fire for this field. Deliberately NOT part of `saveRemoteSettings`'s
   * payload for the same reason.
   */
  setBaseCurrency: (currency: string) => void;
  /** Persists immediately, like `setBaseCurrency` — same rationale. */
  setAutoCreateTrips: (enabled: boolean) => void;
  /**
   * Sets (or, with `null`, CLEARS) the user's country-counting threshold and
   * persists it immediately — same rationale as `setBaseCurrency`.
   *
   * `null` is sent to the server explicitly rather than omitted, because
   * omitting the key means "leave my choice alone" and this has to mean "I no
   * longer have one, follow the instance".
   */
  setCountryThreshold: (tier: CountryTier | null) => void;
  loadApiKeysStatus: () => Promise<void>;
  resetSettings: () => void;
  loadRemoteSettings: () => Promise<void>;
  saveRemoteSettings: () => Promise<void>;
  /**
   * Serialized copy of the settings the server is known to hold, stamped after
   * every load and every successful save. The settings page's debounced
   * auto-save compares against it so hydrating the store from the server does
   * not immediately echo the same values back as a write (issue #186).
   * `null` until the first load completes. Never persisted.
   */
  remoteSnapshot: string | null;
  /**
   * True when the current settings differ from what the server is known to
   * hold. Before the first load completes we cannot know, so we assume yes —
   * losing a user's edit is worse than one redundant write.
   */
  hasPendingChanges: () => boolean;
}

// Browser-aware fallbacks for display fields that the backend no longer
// seeds on a fresh install (issue #87). Run once at module load; safe to
// call before the i18n module is fully wired since they only touch
// navigator/Intl.
const detectInitialLanguage = (): LanguagePreference => {
  if (typeof navigator === "undefined") return "en";
  const tag = navigator.language?.split("-")[0];
  return tag === "de" ? "de" : "en";
};
const detectInitialTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  } catch {
    return "Europe/Berlin";
  }
};
const detectInitialDateFormat = (): DateFormat => {
  if (typeof navigator === "undefined") return "DD.MM.YYYY";
  const region = navigator.language?.toLowerCase();
  if (region?.startsWith("en-us")) return "MM/DD/YYYY";
  if (region?.startsWith("en")) return "YYYY-MM-DD";
  return "DD.MM.YYYY";
};

/**
 * Serialize exactly the slices `saveRemoteSettings` transmits, so an unchanged
 * snapshot provably means "the server already has this". Anything not listed
 * here is not written by the save path and must not be listed here either —
 * otherwise a purely local change (e.g. the beta gate) would look like a
 * pending write forever.
 *
 * Exported because the settings page's debounced auto-save subscribes to it as
 * its effect dependency (issue #198). Listing the slices by hand there meant the
 * effect watched `units` and `profile` while the save path sent seven slices, so
 * editing a flight default, a display option, a feature toggle or a notification
 * updated the store and scheduled no write at all. Deriving the dependency from
 * the same function that defines the payload makes that class of bug impossible:
 * a slice added to the save path is watched the moment it is added here.
 */
export const snapshotOf = (state: SettingsState): string =>
  JSON.stringify([
    state.profile,
    state.display,
    state.units,
    state.defaults,
    state.notifications,
    state.features,
    state.cruise,
    state.enabledDomains,
  ]);

const defaultSettings: Omit<
  SettingsState,
  | "setProfile"
  | "setDisplay"
  | "setUnits"
  | "setDefaults"
  | "setNotifications"
  | "setFeatures"
  | "setCruise"
  | "setApiKeys"
  | "syncBetaFeaturesEnabled"
  | "setEnabledDomains"
  | "setBaseCurrency"
  | "setAutoCreateTrips"
  | "setCountryThreshold"
  | "loadApiKeysStatus"
  | "resetSettings"
  | "loadRemoteSettings"
  | "saveRemoteSettings"
  | "hasPendingChanges"
> = {
  remoteSnapshot: null,
  profile: {
    username: "",
    email: "",
    profilePicture: undefined,
    firstName: null,
    lastName: null,
  },
  display: {
    theme: "light",
    language: detectInitialLanguage(),
    timezone: detectInitialTimezone(),
    dateFormat: detectInitialDateFormat(),
    timeFormat: "24h",
  },
  units: {
    distanceUnit: "kilometers",
  },
  defaults: {
    flightStatus: "scheduled",
    // No shipped classification defaults (#256): an untouched flight form
    // must not store a seat class or category the user never picked.
    seatClass: "",
    favoriteAirline: "Lufthansa",
    flightCategory: "",
  },
  notifications: {
    flightReminder: "24h",
  },
  features: {
    enableCostTracking: false,
    trackAircraftRegistration: true,
  },
  cruise: {
    defaultLine: "",
    defaultCabinType: null,
    showCruiseArcs: true,
  },
  apiKeys: null,
  enabledDomains: ["flight"],
  enabledDomainsLoaded: false,
  baseCurrency: "EUR",
  autoCreateTrips: true,
  // No choice yet, and no instance answer yet — both are the server's to fill.
  countryThreshold: null,
  instanceCountryThreshold: null,
  hasCountryTracks: null,
  betaFeaturesEnabled: null,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      setProfile: (updates) =>
        set((state) => ({
          profile: { ...state.profile, ...updates },
        })),
      setDisplay: (updates) =>
        set((state) => ({
          display: { ...state.display, ...updates },
        })),
      setUnits: (updates) =>
        set((state) => ({
          units: { ...state.units, ...updates },
        })),
      setDefaults: (updates) =>
        set((state) => ({
          defaults: { ...state.defaults, ...updates },
        })),
      setNotifications: (updates) =>
        set((state) => ({
          notifications: { ...state.notifications, ...updates },
        })),
      setFeatures: (updates) => set((state) => ({ features: { ...state.features, ...updates } })),
      setCruise: (updates) => set((state) => ({ cruise: { ...state.cruise, ...updates } })),
      setApiKeys: (status) =>
        set(() => ({
          apiKeys: status,
        })),
      syncBetaFeaturesEnabled: (enabled) => set({ betaFeaturesEnabled: enabled }),
      setEnabledDomains: (keys) => {
        set({ enabledDomains: keys });
        void settingsApi.update({ enabledDomains: keys });
      },
      setBaseCurrency: (currency) => {
        set({ baseCurrency: currency });
        settingsApi.update({ baseCurrency: currency }).catch((error: unknown) => {
          logger.warn("Failed to save base currency", error);
        });
      },
      setAutoCreateTrips: (enabled) => {
        set({ autoCreateTrips: enabled });
        settingsApi.update({ autoCreateTrips: enabled }).catch((error: unknown) => {
          logger.warn("Failed to save autoCreateTrips", error);
        });
      },
      setCountryThreshold: (tier) => {
        set({ countryThreshold: tier });
        settingsApi.update({ countryThreshold: tier }).catch((error: unknown) => {
          logger.warn("Failed to save countryThreshold", error);
        });
      },
      loadApiKeysStatus: async () => {
        try {
          const status = await settingsApi.getApiKeys();
          set({ apiKeys: status });
        } catch (error) {
          logger.warn("Failed to load API keys status", error);
        }
      },
      resetSettings: () => set(defaultSettings),
      hasPendingChanges: () => {
        const state = get();
        if (state.remoteSnapshot === null) return true;
        return snapshotOf(state) !== state.remoteSnapshot;
      },
      loadRemoteSettings: async () => {
        // birthdate lives on the User row, not in UserSettings JSON — so
        // it rides on a parallel request. Failure here is non-fatal:
        // the rest of the profile still loads.
        try {
          const { birthdate } = await settingsApi.getProfile();
          set((state) => ({
            ...state,
            profile: { ...state.profile, birthdate },
          }));
        } catch (error) {
          logger.warn("Failed to load user profile (birthdate)", error);
        }
        try {
          const remote = await settingsApi.get();
          if (remote) {
            set((state) => {
              // Extract autoUpdate and historicalEnrichment to exclude them from store
              const remoteRecord = remote as Record<string, unknown>;
              /* eslint-disable @typescript-eslint/no-unused-vars */
              const {
                autoUpdate: _au,
                historicalEnrichment: _he,
                privacy: _privacy,
                backup: _backup,
                ...remoteWithoutDirectFields
              } = remoteRecord;
              /* eslint-enable @typescript-eslint/no-unused-vars */
              // Shallow-merge each settings group instead of replacing it
              // wholesale. The backend's seed defaults intentionally omit
              // browser-detectable fields (display.language / timezone /
              // dateFormat — see issue #87) so local detection survives
              // the first post-login fetch. A blind top-level spread would
              // wipe state.display.language back to undefined whenever the
              // remote payload's display object lacks the key.
              const mergeGroup = <K extends keyof SettingsState>(key: K) => {
                const remoteGroup = remoteWithoutDirectFields[key as string];
                if (remoteGroup && typeof remoteGroup === "object") {
                  return { ...(state[key] as object), ...(remoteGroup as object) };
                }
                return state[key];
              };
              const newState: SettingsState = {
                ...state,
                profile: mergeGroup("profile") as ProfileSettings,
                display: mergeGroup("display") as DisplaySettings,
                units: mergeGroup("units") as UnitsSettings,
                defaults: mergeGroup("defaults") as DefaultsSettings,
                notifications: mergeGroup("notifications") as NotificationSettings,
                features: mergeGroup("features") as FeaturesSettings,
              };
              // Always mirror the auth-store username into profile.username.
              // If the persisted username belongs to a different account
              // (previous login still in localStorage), also drop the
              // email + profile picture so we don't leak them across users.
              // Also scrub the legacy "traveler@example.com" placeholder
              // that shipped as a default in earlier builds and got
              // autosaved into real UserSettings rows.
              const authUser = useAuthStore.getState().user;
              if (authUser?.username) {
                const previousUsername = state.profile?.username ?? "";
                const userChanged =
                  previousUsername !== "" && previousUsername !== authUser.username;
                const incomingEmail = newState.profile?.email ?? "";
                const email =
                  userChanged || incomingEmail === "traveler@example.com" ? "" : incomingEmail;
                newState.profile = {
                  ...newState.profile,
                  username: authUser.username,
                  email,
                  ...(userChanged ? { profilePicture: undefined } : {}),
                };
              }
              // Validate enabledDomains against the known domain keys —
              // drop anything the frontend doesn't understand (e.g. a
              // future domain the backend knows about but we don't yet).
              if (Array.isArray(remote.enabledDomains)) {
                const filtered = remote.enabledDomains.filter((k): k is DomainKey =>
                  (DOMAIN_KEYS as readonly string[]).includes(k as string)
                );
                newState.enabledDomains = filtered;
                newState.enabledDomainsLoaded = true;
              }
              // baseCurrency is a plain top-level field (like enabledDomains),
              // not part of any of the settings-group objects merged above.
              if (typeof remote.baseCurrency === "string" && remote.baseCurrency.length > 0) {
                newState.baseCurrency = remote.baseCurrency;
              }
              // autoCreateTrips is a plain top-level field too. Missing field
              // (older backend) keeps the default `true` = today's behaviour.
              if (typeof remote.autoCreateTrips === "boolean") {
                newState.autoCreateTrips = remote.autoCreateTrips;
              }
              // The user's own threshold choice. Anything that is not one of
              // the three tiers — a missing field on an older backend, a value
              // from a vocabulary that no longer exists — reads as "no choice",
              // which puts the account back on the instance default rather than
              // on a rank nothing can match.
              newState.countryThreshold = asCountryTier(remote.countryThreshold);
              // Instance-level, read-only, same guard.
              newState.instanceCountryThreshold = asCountryTier(remote.instanceCountryThreshold);
              // Per-account, read-only. Anything that is not an explicit
              // boolean — a missing field on an older backend — stays `null`,
              // which every consumer must read as "no tracks": drawing an
              // option that cannot work is worse than withholding one.
              newState.hasCountryTracks =
                typeof remote.hasCountryTracks === "boolean" ? remote.hasCountryTracks : null;
              // Instance-level, read-only. Anything that isn't an explicit
              // `true`/`false` (missing field, older backend) stays `null` =
              // gate closed.
              newState.betaFeaturesEnabled =
                typeof remote.betaFeaturesEnabled === "boolean" ? remote.betaFeaturesEnabled : null;
              return newState;
            });
          }
        } catch (error) {
          logger.warn("Failed to load remote settings, using local defaults", error);
        }
        // Record what the server is now known to hold, so the settings page's
        // debounced auto-save can tell a genuine user edit apart from the
        // hydration it just performed and skip echoing the value straight back.
        set({ remoteSnapshot: snapshotOf(get()) });
      },
      saveRemoteSettings: async () => {
        const {
          profile,
          display,
          units,
          defaults,
          notifications,
          features,
          cruise,
          enabledDomains,
        } = get();

        // The two writes are independent (issue #186): a 400 from the
        // general settings PUT (e.g. a rejected profilePicture value) used
        // to throw before the birthdate PUT ever ran, silently losing the
        // birthdate on every save that also touched the picture. Firing
        // both up front and collecting results with allSettled means one
        // failing never blocks the other.
        const results = await Promise.allSettled([
          settingsApi.update({
            profile,
            display,
            units,
            defaults,
            notifications,
            features,
            cruise,
            enabledDomains,
          }),
          // birthdate lives on a separate endpoint (/settings/profile on the
          // User row). Only PUT when the field was explicitly loaded or set
          // — undefined means "not touched this session, leave backend as-is".
          profile.birthdate !== undefined
            ? settingsApi.updateProfile({ birthdate: profile.birthdate })
            : Promise.resolve(undefined),
        ]);

        const failures = results.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        if (failures.length > 0) {
          for (const failure of failures) {
            logger.warn("Failed to save settings remotely", failure.reason);
          }
          // Surface a real failure instead of only logging a warning, so
          // callers (e.g. saveProfileSettings) can show their error toast.
          throw failures[0].reason;
        }
        set({ remoteSnapshot: snapshotOf(get()) });
      },
    }),
    {
      name: "settings-storage",
      // The beta gate is instance state, not user state: never persist it.
      // A cached `true` in localStorage would let a hidden feature flash into
      // view on production before the first /settings response lands.
      partialize: (state) => {
        // The beta gate is instance state; `remoteSnapshot` is a belief about
        // the live server. Persisting either would let a stale value from a
        // previous session decide what we skip writing today.
        const {
          betaFeaturesEnabled: _beta,
          instanceCountryThreshold: _instanceThreshold,
          hasCountryTracks: _hasTracks,
          remoteSnapshot: _snapshot,
          enabledDomainsLoaded: _domainsLoaded,
          ...rest
        } = state;
        return rest as unknown as Record<string, unknown>;
      },
      // Strip removed fields from persisted state so stale localStorage doesn't crash the app
      migrate: (persisted: unknown) => {
        const s = { ...(persisted as Record<string, unknown>) };
        delete s["privacy"];
        delete s["backup"];
        // Legacy per-user map settings (style/zoom/marker/colour) — nothing
        // consumed them anymore; the in-map control panel owns map appearance.
        delete s["map"];
        // Drop any value written before `partialize` existed.
        delete s["betaFeaturesEnabled"];
        delete s["instanceCountryThreshold"];
        delete s["hasCountryTracks"];
        return s;
      },
    }
  )
);
