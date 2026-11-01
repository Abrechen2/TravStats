import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { statsApi } from "../../lib/api/stats";
import { logger } from "../../lib/logger";
import { SectionCard } from "./SettingsShared";
import { SettingRows } from "../ui/SettingRow";
import {
  JumpControl,
  LinkButton,
  SettingItem,
  StatusValue,
  useGuardedNavigate,
} from "../ui/settings";

interface Counts {
  visited: number;
  ground: number;
}

/**
 * "Länder": which countries count, in numbers the server measured.
 *
 * Country counts use two explicit sets (the unified rule of 2026-10-14): a
 * country is VISITED on a confirmed stay, place visit, landing excursion, home
 * country or a trip there and back, and has GROUND CONTACT on any evidence. The
 * old threshold is no longer a dial — a switch that changes nothing would be a
 * simulated setting — so the rows state the rule and show both sets as they
 * stand. A count that could not be read is said, never shown as zero.
 */
export default function CountryCountingCard(): JSX.Element {
  const { t } = useTranslation(["settings", "passport"]);
  const navigate = useGuardedNavigate();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      const { summary } = await statsApi.getPassport();
      setCounts({
        visited: summary.visitedCountries ?? summary.countries,
        ground: summary.groundCountries ?? summary.countriesTotal,
      });
    } catch (error) {
      logger.warn("Failed to read the country counts", error);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const error = failed ? t("settings:countryCounting.loadFailed") : undefined;
  const value = (n: number | undefined): JSX.Element => (
    <StatusValue>{n === undefined ? "…" : n}</StatusValue>
  );

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:countryCounting.visited.name")}
          sub={t("settings:countryCounting.visited.sub")}
          help={t("passport:tiers.visitedExplained")}
          error={error}
          control={value(counts?.visited)}
        >
          {failed && (
            <LinkButton onClick={() => void load()}>{t("settings:blocks.save.retry")}</LinkButton>
          )}
        </SettingItem>
        <SettingItem
          title={t("settings:countryCounting.ground.name")}
          sub={t("settings:countryCounting.ground.sub")}
          help={t("passport:countingRule")}
          control={value(counts?.ground)}
        />
        <SettingItem
          title={t("settings:countryCounting.passport.name")}
          control={
            <JumpControl
              label={t("settings:countryCounting.passport.open")}
              onJump={() => navigate("/passport")}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
