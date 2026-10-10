import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { PhotoJourney } from "../../../types/photoJourney";
import PassPlacePicker from "../../Roadtrips/PassPlacePicker";
import Button from "../../ui/Button";
import { Field, Input } from "../../ui/Field";

import { defaultLocal, type VisitCorrection } from "./reviewItems";

/**
 * Correct one suggestion before accepting it (forgejo#211, O5): the place —
 * the proposed one, or an own place picked from ALL of the reader's places,
 * nearest first — its name, and when the visit was, on the place's clock.
 *
 * The time is the wall clock where the photos were taken, as the card shows
 * it, and goes to the server as `{local}`: the browser never turns it into an
 * instant, so a reader in Berlin correcting a stop in Seoul types Seoul time.
 */
export default function VisitSuggestionCorrection({
  journey,
  correction,
  onChange,
}: {
  journey: PhotoJourney;
  correction: VisitCorrection;
  onChange: (next: VisitCorrection) => void;
}): JSX.Element {
  const { t } = useTranslation(["dataQuality"]);
  const key = (k: string) => `dataQuality:inbox.photoJourneys.review.correction.${k}`;
  const id = (k: string) => `visit-${journey.id}-${k}`;
  const local = correction.local ?? defaultLocal(journey);

  return (
    <div
      className="mt-3 flex flex-col rounded-[var(--ts-radius-tile)] p-3"
      style={{ gap: "var(--ts-space-md)", background: "var(--ts-surface2)" }}
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        <span className="t-label-mono">{t(key("place"))}</span>
        {correction.place ? (
          <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
            <span style={{ color: "var(--ts-text-bright)", fontWeight: 600 }}>
              {t(key("placeChosen"), { name: correction.place.name })}
            </span>
            <Button onClick={() => onChange({ ...correction, place: undefined })}>
              {t(key("resetPlace"))}
            </Button>
          </div>
        ) : (
          <>
            <p className="t-caption">
              {journey.placeId ? t(key("placeOwnSuggested")) : t(key("placeNew"))}
            </p>
            <PassPlacePicker
              near={{ lat: journey.lat, lon: journey.lon }}
              onPick={(place) =>
                onChange({ ...correction, place: { id: place.id, name: place.name } })
              }
            />
          </>
        )}
      </div>

      {!correction.place && !journey.placeId && (
        <>
          <Field label={t(key("name"))} htmlFor={id("name")}>
            <Input
              id={id("name")}
              value={correction.name ?? journey.suggestedName ?? ""}
              maxLength={200}
              onChange={(event) => onChange({ ...correction, name: event.target.value })}
            />
          </Field>
          <Field label={t(key("localName"))} htmlFor={id("local-name")}>
            <Input
              id={id("local-name")}
              value={correction.localName ?? journey.suggestedLocalName ?? ""}
              maxLength={200}
              onChange={(event) => onChange({ ...correction, localName: event.target.value })}
            />
          </Field>
        </>
      )}

      {journey.startLocal ? (
        <Field label={t(key("time"))} htmlFor={id("time")} hint={t(key("timeHint"))}>
          <Input
            id={id("time")}
            type="datetime-local"
            value={local}
            onChange={(event) => onChange({ ...correction, local: event.target.value })}
          />
        </Field>
      ) : (
        // Without the place's zone there is no wall clock to correct against.
        <p className="t-caption">{t(key("timeUnavailable"))}</p>
      )}
    </div>
  );
}
