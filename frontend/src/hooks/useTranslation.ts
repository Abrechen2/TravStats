import { useEffect } from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { useSettingsStore } from '../store/settingsStore';
import i18n from '../i18n/config';

/**
 * Custom hook that wraps react-i18next's useTranslation
 * and automatically syncs with the settings store language
 */
export function useTranslation(namespace?: string | string[]) {
  const language = useSettingsStore((state) => state.display.language);
  const translation = useI18nTranslation(namespace);

  // Ensure i18n language matches settings store (use useEffect to avoid side effects during render)
  useEffect(() => {
    if (language) {
      const currentLang = i18n.language || i18n.resolvedLanguage;
      if (currentLang !== language) {
        i18n.changeLanguage(language).catch((err) => {
          console.warn('Failed to change language:', err);
        });
      }
    }
  }, [language]);

  return translation;
}

