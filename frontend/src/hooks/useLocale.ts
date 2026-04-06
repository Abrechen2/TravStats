import { useSettingsStore } from "../store/settingsStore";

const LOCALE_MAP: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
};

export function useLocale(): string {
  const language = useSettingsStore((s) => s.display.language);
  return LOCALE_MAP[language] ?? "de-DE";
}
