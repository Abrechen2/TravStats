import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { trackGapApi } from "../../../lib/api/trackGap";
import { logger } from "../../../lib/logger";
import {
  ChoiceControl,
  ErrorLine,
  SettingItem,
  useSettingWrite,
  type ChoiceOption,
} from "../../ui/settings";

/** The gaps offered; a stored value outside this list is shown as its own option. */
export const TRACK_GAP_PRESETS = [15, 30, 60, 120, 240, 720] as const;

/**
 * Settings → Standort → "Track trennen ab": the one time gap after which a
 * recording becomes a new track. Time only — distance never splits a track,
 * as in Dawarich. A failed load draws no value nobody chose; a failed save
 * keeps the choice with the usual retry.
 */
export default function TrackGapSetting({ locked }: { locked?: Locked }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (locked) return;
    let live = true;
    trackGapApi
      .get()
      .then((s) => live && setMinutes(s.minutes))
      .catch((err: unknown) => {
        logger.error("TrackGapSetting: load failed", err);
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [locked]);

  const write = useSettingWrite<string>("location.trackGap", String(minutes ?? 120), async (v) => {
    const saved = await trackGapApi.set(Number(v));
    setMinutes(saved.minutes);
  });

  const values: number[] = [...TRACK_GAP_PRESETS];
  if (minutes !== null && !values.includes(minutes)) values.push(minutes);
  values.sort((a, b) => a - b);
  const options: ChoiceOption<string>[] = values.map((m) => ({
    value: String(m),
    label: t("settings:location.trackGap.option", { count: m }),
  }));

  return (
    <SettingItem
      title={t("settings:location.trackGap.name")}
      name={t("settings:location.trackGap.name")}
      sub={t("settings:location.trackGap.sub")}
      help={t("settings:location.trackGap.help")}
      save={write}
      locked={locked}
      control={
        minutes !== null && !locked ? (
          <ChoiceControl
            value={write.value}
            options={options}
            label={t("settings:location.trackGap.name")}
            onChange={write.choose}
          />
        ) : undefined
      }
    >
      {loadFailed ? <ErrorLine>{t("settings:location.trackGap.loadError")}</ErrorLine> : null}
    </SettingItem>
  );
}

type Locked = { why: "demo"; reason: string };
