import i18next, { type TFunction } from "i18next";

/**
 * A real i18next `t` over the real German resource files — interpolation,
 * plurals and all.
 *
 * The global test mock returns the KEY, so a call that forgets a variable
 * ("mit {{count}} Besuchen") passes every test and ships raw braces. A test
 * that asserts what a German reader sees needs the real engine; this is it.
 * Unknown keys come back as the key, as in the app.
 */
const modules = import.meta.glob<{ default: Record<string, unknown> }>(
  "../../i18n/resources/de/*.json",
  { eager: true }
);

const resources: Record<string, Record<string, unknown>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const ns = path.replace(/^.*\/([^/]+)\.json$/, "$1");
  resources[ns] = mod.default;
}

const instance = i18next.createInstance();
void instance.init({
  lng: "de",
  fallbackLng: false,
  ns: Object.keys(resources),
  defaultNS: "common",
  resources: { de: resources },
  interpolation: { escapeValue: false },
  initAsync: false,
});

export const germanT: TFunction = instance.t.bind(instance) as TFunction;

/** A `useTranslation` stand-in for `vi.mock("…/hooks/useTranslation")`. */
export function germanUseTranslation(): {
  t: TFunction;
  i18n: { language: string; changeLanguage: () => Promise<void>; isInitialized: boolean };
  ready: boolean;
} {
  return {
    t: germanT,
    i18n: { language: "de", changeLanguage: async () => {}, isInitialized: true },
    ready: true,
  };
}
