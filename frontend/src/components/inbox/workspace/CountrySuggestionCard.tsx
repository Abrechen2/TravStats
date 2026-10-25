import { useRef, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../../lib/apiError";
import { saveErrorKey } from "../../../lib/saveErrorMessage";
import {
  locationSuggestionsApi,
  suggestionDays,
  type CountryVerdict,
  type LocationSuggestion,
} from "../../../lib/api/locationSuggestions";
import { countryName } from "../../../shared/geo/countryCode";
import Button from "../../ui/Button";
import { W } from "./model";

const L = `${W}.location`;

/** Answers retried quietly: an accept still being saved elsewhere, a history still moving. */
const RETRYABLE = new Set(["SUGGESTION_ACCEPT_IN_PROGRESS", "HISTORY_CHANGED"]);

/** How often a retryable answer is retried, and how long apart. */
const BUSY_RETRIES = 3;
const BUSY_DELAY_MS = 600;

/** Codes whose answer removes the card: the list is reloaded after the message. */
const RELOADING = new Set(["EVIDENCE_INVALIDATED", "SUGGESTION_ALREADY_RESOLVED"]);

const ERROR_KEYS: Readonly<Record<string, string>> = {
  EVIDENCE_INVALIDATED: `${L}.errors.invalidated`,
  SUGGESTION_ALREADY_RESOLVED: `${L}.errors.resolved`,
  SUGGESTION_ACCEPT_IN_PROGRESS: `${L}.errors.busy`,
  HISTORY_CHANGED: `${L}.errors.historyChanged`,
  TRAVTRACK_DISABLED: `${L}.errors.disabled`,
  TRAVTRACK_UNAVAILABLE: `${L}.errors.providerOff`,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `YYYY-MM-DD` as the reader's date; the days are UTC days, so read in UTC. */
function formatDay(day: string, language: string): string {
  return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * A TravTrack country question (TravTrack plan E6): TravTrack saw the reader
 * on the ground in a country the passport does not hold. "Besucht" and "Nur am
 * Boden durchgereist" save the reader's own country verdict; "Nicht dort
 * gewesen" saves nothing but the answer, and those days are not asked again.
 */
export default function CountrySuggestionCard({
  suggestion,
  disabled,
  reload,
}: {
  suggestion: LocationSuggestion;
  disabled: boolean;
  reload: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation(["dataQuality", "common"]);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = String(suggestion.explanation.params.country ?? "");
  const country = countryName(code, i18n.language) || code;
  const { first, last } = suggestionDays(suggestion);

  const run = async (operation: () => Promise<unknown>) => {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await operation();
          break;
        } catch (failure) {
          // Another click of the same answer is still being saved, or the
          // history moved while it was checked: wait, then ask again.
          const retryable = RETRYABLE.has(apiErrorMachineCode(failure) ?? "");
          if (!retryable || attempt >= BUSY_RETRIES) throw failure;
          await wait(BUSY_DELAY_MS);
        }
      }
      await reload();
    } catch (failure) {
      setError(t(saveErrorKey(failure, `${W}.saveFailed`, ERROR_KEYS)));
      if (RELOADING.has(apiErrorMachineCode(failure) ?? "")) await reload();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const accept = (verdict: CountryVerdict) =>
    run(() => locationSuggestionsApi.accept(suggestion.id, verdict));
  const working = busy || disabled;

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-(--ts-bad)">
          {error}
        </p>
      )}
      <h3 className="text-base font-semibold">{t(`${L}.question`, { country })}</h3>
      <p className="t-caption">{t(`${L}.source`)}</p>
      <p className="text-sm">
        {t(`${L}.evidence`, {
          days: suggestion.explanation.params.days,
          points: suggestion.explanation.params.points,
          first: formatDay(first, i18n.language),
          last: formatDay(last, i18n.language),
        })}
      </p>
      {suggestion.coverage === "truncated" && <p className="t-caption">{t(`${L}.partial`)}</p>}
      <p className="t-caption">{t(`${L}.effect`)}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={working} onClick={() => void accept("visited")}>
          {t(`${L}.visited`)}
        </Button>
        <Button disabled={working} onClick={() => void accept("ground")}>
          {t(`${L}.ground`)}
        </Button>
        <Button
          disabled={working}
          onClick={() => void run(() => locationSuggestionsApi.reject(suggestion.id))}
        >
          {t(`${L}.notThere`)}
        </Button>
      </div>
    </div>
  );
}
