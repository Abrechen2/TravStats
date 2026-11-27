import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { useSettingsStore } from "../store/settingsStore";

// Get initial language: stored preference → browser language → fallback "en"
const getInitialLanguage = (): string => {
  try {
    const stored = localStorage.getItem("settings-storage");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.state?.display?.language) {
        return parsed.state.display.language;
      }
    }
  } catch (error) {
    console.warn("[i18n] Initialization failed, using defaults", error);
  }
  // Auto-detect from browser: "de", "de-DE", "de-AT" etc. → "de"
  const browserLang = navigator.language?.split("-")[0];
  if (browserLang === "de" || browserLang === "en") {
    return browserLang;
  }
  return "en";
};

/**
 * The translation files load per language, not in the entry chunk (perf
 * audit 2026-11, item 10): all 56 namespaces of both languages were imported
 * statically, 3.1 MB of JSON in a 2.97 MB / 907 KB gzip entry chunk that every
 * cold start parsed. Each file is now its own chunk; the active language is
 * awaited before the app renders (`i18nReady`, main.tsx), the other one loads
 * when the user switches (`changeLanguage`). Namespaces are not split further
 * per route: with `useSuspense: false` a namespace that arrives after its view
 * rendered would flash its raw keys.
 */
const LANGUAGES = ["en", "de"] as const;
type Language = (typeof LANGUAGES)[number];
const loaders = import.meta.glob<{ default: Record<string, unknown> }>("./resources/*/*.json");
const loadedLanguages = new Map<string, Promise<void>>();

/** Adds every namespace of `lng` to i18next; once per language, shared by concurrent callers. */
export function loadLanguage(lng: string): Promise<void> {
  const known = loadedLanguages.get(lng);
  if (known) return known;
  const prefix = `./resources/${lng}/`;
  const run = Promise.all(
    Object.entries(loaders)
      .filter(([file]) => file.startsWith(prefix))
      .map(async ([file, load]) => {
        const ns = file.slice(prefix.length).replace(/\.json$/, "");
        const mod = await load();
        i18n.addResourceBundle(lng, ns, mod.default, true, true);
      })
  ).then(() => undefined);
  // A failed chunk is not remembered: the next call tries again.
  run.catch(() => loadedLanguages.delete(lng));
  loadedLanguages.set(lng, run);
  return run;
}

// Initialize i18n synchronously with initAsync: false (named initImmediate
// before i18next 24; the alias was dropped in 26)
// This ensures resources are available immediately
const initialLanguage = getInitialLanguage();

i18n.use(initReactI18next).init({
  resources: {},
  partialBundledLanguages: true,
  lng: initialLanguage,
  fallbackLng: "en",
  defaultNS: "common",
  ns: [
    "common",
    "dashboard",
    "settings",
    "flights",
    "bulkEdit",
    "auth",
    "admin",
    "training",
    "errors",
    "achievements",
    "stats",
    "flightStatsHelp",
    "setup",
    "map",
    "pendingUpdates",
    "parser",
    "trips",
    "cruise",
    "rail",
    "bus",
    "changeHistory",
    "rental",
    "import",
    "aircraft",
    "passport",
    "specialFlights",
    "immich",
    "whatsNew",
    "readiness",
    "usageStats",
    "pushRelay",
    "provenance",
    "purpose",
    "settingsRows",
    "lodging",
    "location",
    "track",
    "companions",
    "places",
    "xlsx",
    "dataQuality",
    "sharing",
    "evidence",
    "documents",
    "mailIntake",
    "roadtrips",
    "routing",
    "openData",
    "externalServices",
    "suggestionSources",
    "loyalty",
    "notes",
  ],
  interpolation: {
    escapeValue: false, // React already escapes values
  },
  react: {
    useSuspense: false, // Disable suspense for better compatibility
    bindI18n: "languageChanged loaded", // Re-render on language change
    bindI18nStore: "added removed", // Re-render when resources change
  },
  // Critical: Initialize synchronously so resources are available immediately
  initAsync: false,
  // Ensure translations are available immediately
  load: "languageOnly",
  // Return key if translation is missing (for debugging)
  returnEmptyString: false,
  returnNull: false,
  // Key separator for nested keys
  keySeparator: ".",
  // Namespace separator
  nsSeparator: ":",
});

/**
 * Resolves when the active language's translations are in. Tests (Vitest) get
 * both languages, since several compare them. A failed load is logged and the
 * app renders anyway: keys on screen beat a blank page, and the stale-bundle
 * recovery reloads on a missing chunk.
 */
export const i18nReady: Promise<void> = Promise.all(
  (import.meta.env.MODE === "test" ? [...LANGUAGES] : [initialLanguage]).map(loadLanguage)
)
  .then(() => undefined)
  .catch((error: unknown) => {
    console.warn("[i18n] Loading the translations failed", error);
  });

// Every switch, whoever asks for it (the settings store sync in App.tsx and
// useTranslation, the display setting): the new language's files follow, and
// react-i18next re-renders on "added" (bindI18nStore).
i18n.on("languageChanged", (lng) => {
  loadLanguage(lng).catch((error: unknown) => {
    console.warn(`[i18n] Loading the ${lng} translations failed`, error);
  });
});

// Function to change language and update settings store
export const changeLanguage = async (lng: Language): Promise<void> => {
  await loadLanguage(lng);
  await i18n.changeLanguage(lng);
  const settingsStore = useSettingsStore.getState();
  settingsStore.setDisplay({ language: lng });
  settingsStore.saveRemoteSettings().catch((error: unknown) => {
    console.warn("[i18n] Failed to save language preference remotely", error);
  });
};

export default i18n;
