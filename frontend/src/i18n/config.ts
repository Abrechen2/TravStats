import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { useSettingsStore } from "../store/settingsStore";

// Import translation files
import enCommon from "./resources/en/common.json";
import enDashboard from "./resources/en/dashboard.json";
import enSettings from "./resources/en/settings.json";
import enFlights from "./resources/en/flights.json";
import enAuth from "./resources/en/auth.json";
import enAdmin from "./resources/en/admin.json";
import enTraining from "./resources/en/training.json";
import enErrors from "./resources/en/errors.json";
import enAchievements from "./resources/en/achievements.json";
import enStats from "./resources/en/stats.json";
import enSetup from "./resources/en/setup.json";
import enOnboarding from "./resources/en/onboarding.json";
import enMap from "./resources/en/map.json";
import enPendingUpdates from "./resources/en/pendingUpdates.json";

import deCommon from "./resources/de/common.json";
import deDashboard from "./resources/de/dashboard.json";
import deSettings from "./resources/de/settings.json";
import deFlights from "./resources/de/flights.json";
import deAuth from "./resources/de/auth.json";
import deAdmin from "./resources/de/admin.json";
import deTraining from "./resources/de/training.json";
import deErrors from "./resources/de/errors.json";
import deAchievements from "./resources/de/achievements.json";
import deStats from "./resources/de/stats.json";
import deSetup from "./resources/de/setup.json";
import deOnboarding from "./resources/de/onboarding.json";
import deMap from "./resources/de/map.json";
import dePendingUpdates from "./resources/de/pendingUpdates.json";

// Get initial language from settings store
const getInitialLanguage = (): string => {
  try {
    const stored = localStorage.getItem("settings-storage");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.state?.display?.language) {
        return parsed.state.display.language;
      }
    }
  } catch {
    // Fallback to default
  }
  return "en"; // Default to English
};

const resources = {
  en: {
    common: enCommon,
    dashboard: enDashboard,
    settings: enSettings,
    flights: enFlights,
    auth: enAuth,
    admin: enAdmin,
    training: enTraining,
    errors: enErrors,
    achievements: enAchievements,
    stats: enStats,
    setup: enSetup,
    onboarding: enOnboarding,
    map: enMap,
    pendingUpdates: enPendingUpdates,
  },
  de: {
    common: deCommon,
    dashboard: deDashboard,
    settings: deSettings,
    flights: deFlights,
    auth: deAuth,
    admin: deAdmin,
    training: deTraining,
    errors: deErrors,
    achievements: deAchievements,
    stats: deStats,
    setup: deSetup,
    onboarding: deOnboarding,
    map: deMap,
    pendingUpdates: dePendingUpdates,
  },
};

// Initialize i18n synchronously with initImmediate: false
// This ensures resources are available immediately
i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: "en",
  defaultNS: "common",
  ns: [
    "common",
    "dashboard",
    "settings",
    "flights",
    "auth",
    "admin",
    "training",
    "errors",
    "achievements",
    "stats",
    "setup",
    "onboarding",
    "map",
    "pendingUpdates",
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
  initImmediate: false,
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

// Function to change language and update settings store
export const changeLanguage = async (lng: "en" | "de"): Promise<void> => {
  await i18n.changeLanguage(lng);
  const settingsStore = useSettingsStore.getState();
  settingsStore.setDisplay({ language: lng });
  settingsStore.saveRemoteSettings().catch(() => {
    // Silently fail if remote save fails
  });
};

export default i18n;
