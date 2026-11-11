import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { tripSuggestionsApi } from "../../lib/api/tripSuggestions";
import { logger } from "../../lib/logger";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { SettingItem, StatusValue } from "../ui/settings";
import { useRowCopy } from "./rowCopy";

/**
 * "Offene Vorschläge" (settings v3, Reisen & Vorschläge): how many trip
 * suggestions wait in the inbox. A count that could not be read is "–", never
 * 0 — an empty inbox and an unreadable one are different answers — and with
 * trip suggestions switched off nothing is counted at all.
 */
export default function OpenSuggestionsRow(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const copy = useRowCopy("trips")("offenevor");
  const on = useSuggestionSwitchesStore((s) => s.trips);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    tripSuggestionsApi
      .count()
      .then((n) => alive && setCount(n))
      .catch((error: unknown) => {
        logger.warn("Failed to load the open suggestion count", error);
        if (alive) setCount(null);
      });
    return () => {
      alive = false;
    };
  }, [on]);

  const value = !on
    ? t("settingsRows:trips.offenevor.off")
    : count === null
      ? "–"
      : t("settingsRows:trips.offenevor.count", { count });
  return <SettingItem title={copy.title} control={<StatusValue>{value}</StatusValue>} />;
}
