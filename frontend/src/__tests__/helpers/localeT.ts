import i18next, { type TFunction } from "i18next";

/**
 * A real i18next `t` over the real resource files of ONE locale — the
 * bilingual sibling of `germanT.ts`, for tests that must show what an English
 * reader sees as well as a German one. Interpolation and plurals included;
 * the global mock returns the key and drops both.
 */
const deModules = import.meta.glob<{ default: Record<string, unknown> }>(
  "../../i18n/resources/de/*.json",
  { eager: true }
);
const enModules = import.meta.glob<{ default: Record<string, unknown> }>(
  "../../i18n/resources/en/*.json",
  { eager: true }
);

export type TestLocale = "de" | "en";

function namespaces(
  modules: Record<string, { default: Record<string, unknown> }>
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [path, mod] of Object.entries(modules)) {
    out[path.replace(/^.*\/([^/]+)\.json$/, "$1")] = mod.default;
  }
  return out;
}

const instances: Record<TestLocale, typeof i18next> = {
  de: i18next.createInstance(),
  en: i18next.createInstance(),
};
for (const [lng, modules] of [
  ["de", deModules],
  ["en", enModules],
] as const) {
  const resources = namespaces(modules);
  void instances[lng].init({
    lng,
    fallbackLng: false,
    ns: Object.keys(resources),
    defaultNS: "common",
    resources: { [lng]: resources },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
}

/** A `useTranslation` stand-in honouring the namespaces the component asks for. */
export function localeUseTranslationNs(
  lng: TestLocale,
  ns?: string | readonly string[]
): {
  t: TFunction;
  i18n: { language: string; changeLanguage: () => Promise<void>; isInitialized: boolean };
  ready: boolean;
} {
  const list = ns === undefined ? undefined : typeof ns === "string" ? [ns] : [...ns];
  const base = instances[lng].t.bind(instances[lng]);
  const t = ((key: string, options?: Record<string, unknown>) =>
    base(key, { ...(list ? { ns: list } : {}), ...options })) as TFunction;
  return {
    t,
    i18n: { language: lng, changeLanguage: async () => {}, isInitialized: true },
    ready: true,
  };
}
