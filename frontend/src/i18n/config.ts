import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useSettingsStore } from '../store/settingsStore';

// Import translation files
import enCommon from './resources/en/common.json';
import enDashboard from './resources/en/dashboard.json';
import enSettings from './resources/en/settings.json';
import enFlights from './resources/en/flights.json';
import enAuth from './resources/en/auth.json';
import enAdmin from './resources/en/admin.json';
import enTraining from './resources/en/training.json';
import enErrors from './resources/en/errors.json';

import deCommon from './resources/de/common.json';
import deDashboard from './resources/de/dashboard.json';
import deSettings from './resources/de/settings.json';
import deFlights from './resources/de/flights.json';
import deAuth from './resources/de/auth.json';
import deAdmin from './resources/de/admin.json';
import deTraining from './resources/de/training.json';
import deErrors from './resources/de/errors.json';

// Get initial language from settings store
const getInitialLanguage = (): string => {
  try {
    const stored = localStorage.getItem('settings-storage');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.state?.display?.language) {
        return parsed.state.display.language;
      }
    }
  } catch (e) {
    // Fallback to default
  }
  return 'en'; // Default to English
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
  },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'dashboard', 'settings', 'flights', 'auth', 'admin', 'training', 'errors'],
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false, // Disable suspense for better compatibility
    },
    debug: false, // Set to true for debugging translation issues
    // Ensure translations are available immediately
    load: 'languageOnly',
    // Prevent missing translation keys from showing
    returnEmptyString: false,
    returnNull: false,
  });

// Function to change language and update settings store
export const changeLanguage = (lng: 'en' | 'de') => {
  i18n.changeLanguage(lng);
  const settingsStore = useSettingsStore.getState();
  settingsStore.setDisplay({ language: lng });
  settingsStore.saveRemoteSettings().catch(() => {
    // Silently fail if remote save fails
  });
};

export default i18n;

