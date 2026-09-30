import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatDate } from "../../lib/displayFormat";
import { listFrequentFlyerSuggestions } from "../../lib/api/loyalty";
import { logger } from "../../lib/logger";
import type { FrequentFlyerSuggestion } from "../../types/loyalty";
import type { CardPrefill } from "./LoyaltyCardForm";
import { maskNumber } from "./MaskedNumber";

interface Props {
  /** Opens the card form prefilled; nothing is saved until the user confirms there. */
  onAdopt: (prefill: CardPrefill) => void;
  /**
   * Bumped by the section after a card was saved. Once the list is open it
   * reloads, so a number just confirmed as a card leaves the list — and one
   * whose form was cancelled stays in it.
   */
  reloadSignal: number;
}

/**
 * "Aus deinen Flügen übernehmen": frequent-flyer numbers that sit on flights
 * but on no card yet. Loaded on demand rather than with the page — it reads
 * every numbered flight, and most visits to the page are not for this.
 */
export default function FrequentFlyerSuggestions({ onAdopt, reloadSignal }: Props): JSX.Element {
  const { t } = useTranslation(["loyalty"]);
  const [suggestions, setSuggestions] = useState<FrequentFlyerSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = async (): Promise<void> => {
    opened.current = true;
    setLoading(true);
    setError(false);
    try {
      setSuggestions(await listFrequentFlyerSuggestions());
    } catch (err: unknown) {
      logger.error("FrequentFlyerSuggestions: load failed", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) return;
    void load();
    // Only the signal re-runs this; `load` is a fresh closure every render.
  }, [reloadSignal]);

  if (suggestions === null) {
    return (
      <div>
        <button
          type="button"
          data-testid="loyalty-suggestions-open"
          onClick={() => void load()}
          disabled={loading}
          className="btn-secondary"
        >
          {t("loyalty:suggestions.open")}
        </button>
        {error && (
          <p className="t-caption mt-1" role="alert" style={{ color: "var(--ts-bad)" }}>
            {t("loyalty:suggestions.loadError")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="loyalty-suggestions">
      <p className="label">{t("loyalty:suggestions.title")}</p>
      {suggestions.length === 0 ? (
        <p className="t-caption">{t("loyalty:suggestions.empty")}</p>
      ) : (
        <>
          <p className="t-caption">{t("loyalty:suggestions.hint")}</p>
          <ul className="ts-setting-rows">
            {suggestions.map((s) => (
              <li
                key={s.membershipNumber}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <div>
                  <span style={{ fontWeight: 600, color: "var(--ts-text-bright)" }}>
                    {s.airlines.map((a) => a.name).join(", ") || s.suggestedProgramName}
                  </span>
                  <span className="t-caption ml-2" style={{ fontFamily: "var(--ts-font-mono)" }}>
                    {maskNumber(s.membershipNumber)}
                  </span>
                  <span className="t-caption ml-2">
                    {[
                      t("loyalty:activity.flight", { count: s.flightCount }),
                      s.lastUsed
                        ? t("loyalty:activity.last", {
                            date: formatDate(s.lastUsed, { timeZone: "UTC" }),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onAdopt({
                      programName: s.suggestedProgramName,
                      membershipNumber: s.membershipNumber,
                      coverage: s.airlines
                        .map((a) => a.code)
                        .filter((code): code is string => code !== null),
                    })
                  }
                  className="text-xs hover:underline"
                  style={{ color: "var(--ts-accent)", fontWeight: 600 }}
                >
                  {t("loyalty:suggestions.adopt")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
