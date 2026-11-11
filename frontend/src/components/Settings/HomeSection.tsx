import { useEffect, useMemo, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { settingsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { countryName, ISO_3166_1_ALPHA2 } from "../../shared/geo/countryCode";
import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, useSettingWrite } from "../ui/settings";
import { useExpertRows } from "./frame/useExpertRows";
import HomeAirportSection from "./HomeAirportSection";

const NONE = "";

/**
 * "Heimatort" under Reisearten: the residence with its moves, and the home
 * country (expert). The residence is the one place a home is written (plan
 * `2026-11-01-home-one-source`); the Companion's "home" is its current period.
 * The passport date moved to Profil & Anmeldung (`PassportRow`).
 */
export default function HomeSection(): JSX.Element {
  return (
    <div className="space-y-4">
      <HomeAirportSection view="residence" />
      <HomeFacts />
    </div>
  );
}

function HomeFacts(): JSX.Element {
  const { t, i18n } = useTranslation(["settings"]);
  const locale = i18n?.language ?? "de";
  const isDemo = useIsDemoAccount();
  const [country, setCountry] = useState<string | null>(null);
  const [countryLoadFailed, setCountryLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    settingsApi
      .get()
      .then((s) => alive && setCountry(s.homeCountry ?? NONE))
      .catch((error: unknown) => {
        logger.warn("Failed to load home country", error);
        if (alive) setCountryLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const showCountry = useExpertRows(1);
  const options = useMemo(
    () =>
      ISO_3166_1_ALPHA2.map((code) => ({ code, name: countryName(code, locale) || code }))
        .sort((a, b) => a.name.localeCompare(b.name, locale))
        .map(({ code, name }) => ({ value: code, label: name })),
    [locale]
  );

  const countryWrite = useSettingWrite<string>(
    "account.homeCountry",
    country ?? NONE,
    async (v) => {
      await settingsApi.update({ homeCountry: v === NONE ? null : v });
      setCountry(v);
    }
  );
  const demo = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const loadLock = (
    failed: boolean,
    loaded: boolean
  ): { why: "dependency"; reason: string } | undefined =>
    failed
      ? { why: "dependency", reason: t("settings:home.loadFailed") }
      : loaded
        ? undefined
        : { why: "dependency", reason: t("settings:home.loading") };

  if (!showCountry) return <></>;
  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:home.country.name")}
          sub={t("settings:home.country.sub")}
          help={t("settings:home.country.help")}
          save={countryWrite}
          locked={demo ?? loadLock(countryLoadFailed, country !== null)}
          control={
            <select
              className="input"
              aria-label={t("settings:home.country.name")}
              value={countryWrite.value}
              disabled={country === null || countryLoadFailed}
              onChange={(e) => countryWrite.choose(e.target.value)}
            >
              <option value={NONE}>{t("settings:homeCountry.none")}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
