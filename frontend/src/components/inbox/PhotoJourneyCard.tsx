import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { CardPhotoJourney } from "../../types/photoJourney";
import Button from "../ui/Button";

import PhotoJourneyPreviewStrip from "./PhotoJourneyPreviewStrip";
import { photoJourneyPlan } from "./photoJourneyPlan";
import { photoJourneySpan } from "./photoJourneySpan";

/**
 * One suggested journey: when, where, how many photographs — and the two
 * answers.
 *
 * ## The strip is addressed by index, never by asset id
 *
 * Each thumbnail is `GET /photo-journeys/:id/preview/:index/file`. The row is
 * the grant: the caller owns the journey, and the server reads the asset id out
 * of the stored array at that index. The ids travel in the row, so a card
 * COULD put one in a URL — and then owning one journey would be a reader for
 * the whole library, which is exactly what this route refuses. The array is
 * therefore read for its length only.
 *
 * ## The card never rounds up its own evidence
 *
 * `locatedCount` is shown beside `photoCount` whenever they differ: a burst of
 * sixty photographs located by two is a weaker claim than one located by all
 * sixty, and hiding the difference would present them as equal. The heading is
 * whatever `photoJourneyLabel` made of the row — including coordinates where
 * the reverse lookup answered nothing.
 *
 * A `visit` finding is not drawn here: the batch review answers it
 * (`visitReview/`, forgejo#211 O5).
 */

interface PhotoJourneyCardProps {
  journey: CardPhotoJourney;
  /** Localized place line, built by the tab so both card and message agree. */
  label: string;
  onAccept: () => void;
  onDismiss: () => void;
  busy?: boolean;
}

export default function PhotoJourneyCard({
  journey,
  label,
  onAccept,
  onDismiss,
  busy = false,
}: PhotoJourneyCardProps): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const format = useDisplayFormat();

  const plan = photoJourneyPlan(journey);

  const facts = [
    t("dataQuality:inbox.photoJourneys.facts.photos", { photos: journey.photoCount }),
    journey.locatedCount !== journey.photoCount
      ? t("dataQuality:inbox.photoJourneys.facts.located", { located: journey.locatedCount })
      : null,
    journey.tripName
      ? t("dataQuality:inbox.photoJourneys.facts.trip", { name: journey.tripName })
      : null,
    journey.nights
      ? t("dataQuality:inbox.photoJourneys.facts.nights", { nights: journey.nights })
      : null,
    journey.airportIata
      ? t("dataQuality:inbox.photoJourneys.facts.airport", { iata: journey.airportIata })
      : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <div
      className="rounded-[var(--ts-radius-card)] p-4"
      style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className="rounded-sm px-2 py-1 text-xs font-medium"
          style={{ background: "var(--ts-surface2)", color: "var(--ts-text-bright)" }}
        >
          {t(`dataQuality:inbox.photoJourneys.kind.${journey.kind}`)}
        </span>
        <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
          {photoJourneySpan(journey, format)}
        </span>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>{label}</h3>
      <p className="t-caption mt-1 flex flex-wrap gap-x-3">
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </p>

      <PhotoJourneyPreviewStrip journey={journey} />

      {/* What accepting will do, permanently rather than in a tooltip, and read
          from `photoJourneyPlan` — the same rule the act uses. Keyed on the row
          KIND, this line promised a visit for a `place` finding whose place had
          since been deleted, while the code correctly created nothing: one rule,
          two derivations, so one of them was wrong. */}
      <p className="t-caption mt-3">{t(`dataQuality:inbox.photoJourneys.creates.${plan}`)}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onAccept} disabled={busy}>
          {t("dataQuality:inbox.photoJourneys.actions.accept")}
        </Button>
        <Button onClick={onDismiss} disabled={busy}>
          {t("dataQuality:inbox.photoJourneys.actions.dismiss")}
        </Button>
      </div>
    </div>
  );
}
