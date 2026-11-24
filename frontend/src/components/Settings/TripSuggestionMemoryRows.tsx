import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { tripSuggestionsApi } from "../../lib/api/tripSuggestions";
import { logger } from "../../lib/logger";
import { saveSwitch } from "../../store/confirmedSettings";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import {
  ActionControl,
  ChoiceControl,
  ErrorLine,
  SettingItem,
  useSettingWrite,
  type ChoiceOption,
} from "../ui/settings";
import { useRowCopy } from "./rowCopy";

/** The quiet periods offered; the server accepts any whole number 0–90. */
const QUIET_CHOICES = ["0", "7", "14", "30", "60", "90"] as const;
type QuietChoice = (typeof QUIET_CHOICES)[number];

/**
 * Trip suggestions v2 (owner 2026-11-23: a rejected proposal must never nag):
 * how long after a dismissal nothing over the same days is asked — not even a
 * trip that has grown since — and a way to forget every dismissal at once.
 * Both rows only while trip suggestions are on.
 */
export default function TripSuggestionMemoryRows(): JSX.Element | null {
  const { t } = useTranslation(["settingsRows"]);
  const row = useRowCopy("trips");
  const on = useSuggestionSwitchesStore((s) => s.trips);
  const saved = useSuggestionSwitchesStore((s) => s.tripQuietDays);
  const savedChoice = (
    QUIET_CHOICES.includes(String(saved) as QuietChoice) ? String(saved) : "14"
  ) as QuietChoice;
  const quiet = useSettingWrite<QuietChoice>("trips.suggestions.quietDays", savedChoice, (v, o) =>
    saveSwitch("tripQuietDays", Number(v), o)
  );
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (!on) return null;

  const quietCopy = row("ruhe");
  const resetCopy = row("abgelehnt");
  const options: ChoiceOption<QuietChoice>[] = QUIET_CHOICES.map((value) => ({
    value,
    label: t("settingsRows:trips.ruhe.days", { count: Number(value) }),
  }));
  const reset = async () => {
    setResetting(true);
    setFailed(false);
    try {
      setResult(await tripSuggestionsApi.resetRejections());
    } catch (error: unknown) {
      logger.warn("Failed to reset the declined trip suggestions", error);
      setFailed(true);
    } finally {
      setResetting(false);
    }
  };
  return (
    <>
      <SettingItem
        title={quietCopy.title}
        sub={quietCopy.sub}
        save={quiet}
        control={
          <ChoiceControl
            value={quiet.value}
            options={options}
            onChange={quiet.choose}
            label={quietCopy.title}
          />
        }
      />
      <SettingItem
        title={resetCopy.title}
        sub={
          result !== null ? t("settingsRows:trips.abgelehnt.res", { count: result }) : resetCopy.sub
        }
        control={
          <ActionControl
            label={resetCopy.btn ?? resetCopy.title}
            onClick={() => void reset()}
            busy={resetting}
          />
        }
      />
      {failed && <ErrorLine>{t("settingsRows:trips.abgelehnt.failed")}</ErrorLine>}
    </>
  );
}
