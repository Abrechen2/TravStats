import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { photoJourneyPreviewUrl } from "../../lib/api/photoJourneys";
import type { PhotoJourney } from "../../types/photoJourney";
import Button from "../ui/Button";

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
 */

/**
 * How many thumbnails a row may draw.
 *
 * The scan stores three (`PREVIEW_ASSETS` in `services/photoJourneys/scan.ts`)
 * and the proxy accepts an index up to 63. This cap is what keeps a future
 * bump on the server from silently turning one row into a contact sheet.
 */
const MAX_PREVIEW_THUMBS = 4;

interface PhotoJourneyCardProps {
  journey: PhotoJourney;
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

  const thumbIndexes = journey.previewAssetIds
    .slice(0, MAX_PREVIEW_THUMBS)
    .map((_, index) => index);
  const span =
    journey.startDate.slice(0, 10) === journey.endDate.slice(0, 10)
      ? format.date(journey.startDate)
      : `${format.date(journey.startDate)} – ${format.date(journey.endDate)}`;

  const facts = [
    t("dataQuality:inbox.photoJourneys.facts.photos", { photos: journey.photoCount }),
    journey.locatedCount !== journey.photoCount
      ? t("dataQuality:inbox.photoJourneys.facts.located", { located: journey.locatedCount })
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
          {span}
        </span>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>{label}</h3>
      <p className="t-caption mt-1 flex flex-wrap gap-x-3">
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </p>

      {thumbIndexes.length > 0 && (
        <div className="mt-3 flex gap-2">
          {thumbIndexes.map((index) => (
            <img
              key={index}
              src={photoJourneyPreviewUrl(journey.id, index)}
              alt={t("dataQuality:inbox.photoJourneys.thumbAlt", { position: index + 1 })}
              loading="lazy"
              width={72}
              height={72}
              className="rounded-[var(--ts-radius-tile)] object-cover"
              style={{ width: 72, height: 72, background: "var(--ts-surface2)" }}
            />
          ))}
        </div>
      )}

      {/* What accepting will do, permanently rather than in a tooltip: the
          three readings create three different things, and one of them creates
          nothing at all. That only matters at the moment of clicking. */}
      <p className="t-caption mt-3">
        {t(`dataQuality:inbox.photoJourneys.creates.${journey.kind}`)}
      </p>

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
