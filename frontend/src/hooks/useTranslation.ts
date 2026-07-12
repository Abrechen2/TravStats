import { useEffect, useCallback, useRef } from "react";
import { useTranslation as useI18nTranslation } from "react-i18next";
import { useSettingsStore } from "../store/settingsStore";
import { logger } from "../lib/logger";

/**
 * Custom hook that wraps react-i18next's useTranslation
 * and automatically syncs with the settings store language
 */
export function useTranslation(namespace?: string | string[]): {
  t: (key: string, options?: Record<string, unknown>) => string;
  i18n: typeof import("i18next").default;
  ready: boolean;
} {
  const language = useSettingsStore((state) => state.display.language);
  const translation = useI18nTranslation(namespace);
  const { i18n: i18nInstance } = translation;

  // Sync language from settings store to i18n
  useEffect(() => {
    if (language && i18nInstance.isInitialized) {
      const currentLang = i18nInstance.language;
      if (currentLang !== language) {
        i18nInstance.changeLanguage(language).catch((err: Error) => {
          logger.warn("Failed to change language:", err);
        });
      }
    }
  }, [language, i18nInstance]);

  // react-i18next returns a NEW translation object on every render, so a
  // `t` memoized on it is a new function every render too. Components list
  // `t` in effect/memo dependency arrays; a per-render identity re-fires
  // those on every keystroke (#190 — the admin instance-settings form
  // refetched and reset itself on each typed character). Delegating through
  // a ref keeps `t` referentially stable without going stale, and the
  // deliberate `language` dependency is the ONE re-identity consumers need:
  // it makes `useMemo`s that cache translated strings recompute on a
  // language switch.
  const translationRef = useRef(translation);
  translationRef.current = translation;
  const t = useCallback(
    (key: string, options?: Record<string, unknown>) => {
      return translationRef.current.t(key, options);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `language` is intentional (see above)
    [language]
  );

  return {
    ...translation,
    t,
    i18n: i18nInstance,
  };
}
