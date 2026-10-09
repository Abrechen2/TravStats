import { useEffect, useMemo, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { settingsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { countryName, ISO_3166_1_ALPHA2 } from "../../shared/geo/countryCode";
import { useToastStore } from "../../store/toastStore";
import { SectionCard } from "./SettingsShared";
import { SettingRow, SettingRows } from "../ui/SettingRow";

/** A `<select>` value cannot be null; the empty string stands for "not set". */
const NONE = "";

/**
 * "Heimatland" — which booking templates are tried FIRST (template engine v2,
 * plan 2026-10-09 P5). It orders and never filters: a template for another
 * country stays active, so the help text says so at the control.
 *
 * Self-contained on purpose — it reads and writes `homeCountry` through
 * `settingsApi` itself instead of through `settingsStore`, which sits at the
 * 800-line limit and is not on the size baseline. Nothing else in the web app
 * reads the value; only the server's template engine does.
 *
 * A failed write puts the previous value back and says so, like
 * `persistSetting` does for the store-backed switches.
 */
export default function HomeCountryCard(): JSX.Element {
  const { t, i18n } = useTranslation(["settings"]);
  const locale = i18n?.language ?? "de";
  const [value, setValue] = useState<string>(NONE);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    settingsApi
      .get()
      .then((settings) => {
        if (alive) setValue(settings.homeCountry ?? NONE);
      })
      .catch((error: unknown) => {
        logger.warn("Failed to load home country", error);
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Sorted by the localised name, so the list reads alphabetically in the UI language.
  const options = useMemo(
    () =>
      ISO_3166_1_ALPHA2.map((code) => ({ code, name: countryName(code, locale) || code })).sort(
        (a, b) => a.name.localeCompare(b.name, locale)
      ),
    [locale]
  );

  const onChange = (next: string): void => {
    const previous = value;
    setValue(next);
    settingsApi.update({ homeCountry: next === NONE ? null : next }).catch((error: unknown) => {
      setValue(previous);
      logger.warn("Failed to save home country", error);
      useToastStore.getState().addToast("error", t("settings:errors.saveFailed"));
    });
  };

  return (
    <SectionCard>
      <SettingRows>
        <SettingRow
          title={t("settings:homeCountry.label")}
          htmlFor="settings-home-country"
          sub={
            loadFailed
              ? t("settings:homeCountry.loadFailed")
              : t("settings:homeCountry.description")
          }
          control={
            <select
              id="settings-home-country"
              value={value}
              disabled={loadFailed}
              onChange={(e): void => onChange(e.target.value)}
              className="rounded border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1 text-sm text-[var(--text-primary)]"
            >
              <option value={NONE}>{t("settings:homeCountry.none")}</option>
              {options.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
