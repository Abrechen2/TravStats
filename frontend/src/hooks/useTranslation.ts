import { useEffect, useCallback } from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { useSettingsStore } from '../store/settingsStore';

/**
 * Custom hook that wraps react-i18next's useTranslation
 * and automatically syncs with the settings store language
 */
export function useTranslation(namespace?: string | string[]) {
  const language = useSettingsStore((state) => state.display.language);
  const translation = useI18nTranslation(namespace);
  const { i18n: i18nInstance } = translation;

  // Sync language from settings store to i18n
  useEffect(() => {
    if (language && i18nInstance.isInitialized) {
      const currentLang = i18nInstance.language;
      if (currentLang !== language) {
        i18nInstance.changeLanguage(language).catch((err: Error) => {
          console.warn('Failed to change language:', err);
        });
      }
    }
  }, [language, i18nInstance]);

  // Wrap t function to ensure it always uses the current language
  const t = useCallback(
    (key: string, options?: Record<string, unknown>) => {
      return translation.t(key, options);
    },
    [translation]
  );

  return {
    ...translation,
    t,
    i18n: i18nInstance,
  };
}

