import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import { travTrackMonthsApi } from "../../../lib/api/travtrackMonths";
import { SettingItem, SwitchControl, useSettingWrite } from "../../ui/settings";
import { RowFailure } from "./useRowAction";

const NS = "settings:location.tt.cities";

/**
 * "Städte benennen": the monthly values' city lookup. The switch is the consent
 * — the help names what leaves (positions rounded to 1 km, to the server's
 * place search) and that off removes the cities again. A write that is refused
 * keeps the choice and retries on the row; a setting that cannot be read draws
 * no switch at all rather than an "off" nobody saw.
 */
export default function TravTrackCitiesRow({
  demo,
  active,
}: {
  demo: boolean;
  /** TravTrack is this account's location source and works. */
  active: boolean;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setEnabled(await travTrackMonthsApi.cityLookup());
      setLoadFailed(false);
    } catch (err) {
      logger.warn("TravTrack city lookup could not be loaded", err);
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const write = useSettingWrite<boolean>("location.cities", enabled ?? false, async (on) => {
    setEnabled(await travTrackMonthsApi.setCityLookup(on));
  });

  return (
    <SettingItem
      expert
      title={t(`${NS}.name`)}
      sub={t(`${NS}.sub`)}
      help={t(`${NS}.help`)}
      save={write}
      locked={demo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
      dependency={!demo && !active ? { reason: t(`${NS}.notSource`) } : undefined}
      control={
        enabled !== null ? (
          <SwitchControl checked={write.value} label={t(`${NS}.name`)} onChange={write.choose} />
        ) : undefined
      }
    >
      {loadFailed ? <RowFailure error={t(`${NS}.loadError`)} onRetry={() => void load()} /> : null}
    </SettingItem>
  );
}
