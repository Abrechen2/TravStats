import { useId, useRef, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../../lib/apiError";
import { saveErrorKey } from "../../../lib/saveErrorMessage";
import {
  locationSuggestionsApi,
  type LocationSuggestion,
  type TripAnswer,
} from "../../../lib/api/locationSuggestions";
import { countryName } from "../../../shared/geo/countryCode";
import Button from "../../ui/Button";
import TrackSectionPanel from "../track/TrackSectionPanel";
import { tripSectionProps } from "../track/sectionProps";
import { Field, Input } from "../../ui/Field";
import { W } from "./model";

const T = `${W}.tripAway`;

/** Answers retried quietly: an accept still being saved elsewhere, a history still moving. */
const RETRYABLE = new Set(["SUGGESTION_ACCEPT_IN_PROGRESS", "HISTORY_CHANGED"]);
const BUSY_RETRIES = 3;
const BUSY_DELAY_MS = 600;

/** Codes whose answer removes the card: the list is reloaded after the message. */
const RELOADING = new Set([
  "EVIDENCE_INVALIDATED",
  "SUGGESTION_ALREADY_RESOLVED",
  "SUGGESTION_NOT_FOUND",
  "VALIDATION_FAILED",
]);

const ERROR_KEYS: Readonly<Record<string, string>> = {
  EVIDENCE_INVALIDATED: `${T}.errors.invalidated`,
  SUGGESTION_ALREADY_RESOLVED: `${T}.errors.resolved`,
  SUGGESTION_NOT_FOUND: `${T}.errors.gone`,
  SUGGESTION_ACCEPT_IN_PROGRESS: `${T}.errors.busy`,
  HISTORY_CHANGED: `${T}.errors.historyChanged`,
  EVIDENCE_UNVERIFIABLE: `${T}.errors.unverifiable`,
  TRAVTRACK_DISABLED: `${T}.errors.disabled`,
  TRAVTRACK_UNAVAILABLE: `${T}.errors.providerOff`,
  VALIDATION_FAILED: `${T}.errors.tripGone`,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `YYYY-MM-DD` as the reader's date; a calendar day, so read without a zone shift. */
function formatDay(day: string, language: string): string {
  return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * A trip TravTrack saw (TravTrack plan L4): days the reader spent more than
 * 50 km from their confirmed home that no trip holds. Days, countries and the
 * distance — no map. A new period is answered with "Als Reise anlegen" (a
 * name, then a trip over exactly those days) or "Keine Reise"; a period that
 * touches a trip with "Reise erweitern" (its dates only) or "Nicht erweitern".
 * Neither refusal writes anything but the answer.
 */
export default function TripSuggestionCard({
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
  const nameId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trip = suggestion.trip;
  const language = i18n.language;
  const countries = (trip?.countries ?? []).map((c) => countryName(c, language) || c);
  const [name, setName] = useState(() => countries.join(", "));
  if (!trip) return null;

  const first = formatDay(trip.fromDay, language);
  const last = formatDay(trip.toDay, language);
  const extending = trip.tripId !== null;
  const tripName = trip.tripName ?? t(`${T}.unknownTrip`);

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
  const accept = (answer: TripAnswer) =>
    run(() => locationSuggestionsApi.acceptTrip(suggestion.id, answer));
  const reject = () => run(() => locationSuggestionsApi.reject(suggestion.id));
  const working = busy || disabled;
  const trimmed = name.trim();

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-(--ts-bad)">
          {error}
        </p>
      )}
      <h3 className="text-base font-semibold">
        {extending
          ? t(`${T}.questionExtend`, { first, last, name: tripName })
          : t(`${T}.question`, { first, last })}
      </h3>
      <p className="t-caption">{t(`${T}.source`)}</p>
      <p className="text-sm">
        {trip.km === null
          ? t(`${T}.evidenceDays`, { count: trip.days })
          : t(`${T}.evidence`, { count: trip.days, km: trip.km })}
      </p>
      {countries.length > 0 && (
        <p className="text-sm">{t(`${T}.countries`, { list: countries.join(", ") })}</p>
      )}
      {suggestion.coverage === "truncated" && <p className="t-caption">{t(`${T}.partial`)}</p>}
      <TrackSectionPanel {...tripSectionProps(suggestion, tripName)} />
      <p className="t-caption">{t(extending ? `${T}.effectExtend` : `${T}.effect`)}</p>
      {extending ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={working}
            onClick={() => void accept({ action: "extend", tripId: trip.tripId as string })}
          >
            {t(`${T}.extend`, { name: tripName })}
          </Button>
          <Button disabled={working} onClick={() => void reject()}>
            {t(`${T}.notExtend`)}
          </Button>
        </div>
      ) : (
        <>
          <Field label={t(`${T}.name`)} htmlFor={nameId}>
            <Input
              id={nameId}
              value={name}
              maxLength={200}
              disabled={working}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={working || trimmed === ""}
              onClick={() => void accept({ action: "create", name: trimmed })}
            >
              {t(`${T}.create`)}
            </Button>
            <Button disabled={working} onClick={() => void reject()}>
              {t(`${T}.notTrip`)}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
