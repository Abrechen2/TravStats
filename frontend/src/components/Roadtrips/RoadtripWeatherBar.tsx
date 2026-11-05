import type { JSX } from "react";

import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * "Wetter der Stationen laden": the button above the timeline that asks for
 * the measured weather of the past stations. Hidden while the instance's open
 * data switch is off; says so when no station can have weather yet.
 */
export default function RoadtripWeatherBar({
  eligible,
  running,
  asked,
  onLoad,
}: {
  eligible: number;
  running: boolean;
  asked: boolean;
  onLoad: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["roadtrips"]);
  const openData = useSettingsStore((s) => s.openDataEnabled) === true;
  if (!openData) return null;
  return (
    <div className="flex flex-wrap items-center" style={{ gap: 10, marginBottom: 8 }}>
      <Button variant="secondary" disabled={running || eligible === 0} onClick={onLoad}>
        {running
          ? t("roadtrips:weather.loading")
          : asked
            ? t("roadtrips:weather.reload")
            : t("roadtrips:weather.load")}
      </Button>
      <span className="t-caption">
        {eligible === 0 ? t("roadtrips:weather.none") : t("roadtrips:weather.hint")}
      </span>
    </div>
  );
}
