import { Fragment } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { documentFileUrl } from "../../lib/api/documents";
import { formatRailSpan } from "../../lib/railTime";
import { railTransfers, type RailTransferLeg } from "../../lib/rail/railTransfer";
import type { RailJourney } from "../../types/rail";
import { RailTransferNote } from "./RailTransferNote";
import { trainLabel } from "./trainLabel";
import { useRailLegDocuments, type LegDocuments } from "./useRailLegDocuments";

/** What the view reads of a leg — a booking leg of the detail read, or a full row. */
export type RailCompactLeg = RailTransferLeg &
  Pick<
    RailJourney,
    | "id"
    | "trainCategory"
    | "trainNumber"
    | "status"
    | "travelClass"
    | "coach"
    | "seat"
    | "bookingReference"
    | "tightConnection"
  > &
  /** A full row names its operator; a booking leg of the detail read does not. */
  Partial<Pick<RailJourney, "operator">>;

interface Props {
  legs: readonly RailCompactLeg[];
  /** The leg whose own page this is: marked, not linked. */
  currentId?: string;
  /** The booking's reference; a leg repeats its own only where it differs. */
  pnr: string | null;
  /** False where the page header already names the booking. */
  showPnr?: boolean;
}

const TOUCH_LINK =
  "pointer-coarse:inline-flex pointer-coarse:min-h-(--ts-size-touch-min) items-center";

/**
 * A whole connection on one screen (forgejo#235): per train its time, train,
 * class, coach and seat, its own reference where it differs, its originals as
 * links that open the file — and, between two trains, the change
 * (forgejo#234). Read on the platform, it answers "where do I sit, and how
 * long do I have" without opening each train.
 *
 * A leg with neither coach nor seat says "keine Reservierung erfasst": no
 * reservation RECORDED, which is neither an error nor a seat.
 */
export function RailConnectionView({ legs, currentId, pnr, showPnr = true }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rail", "documents", "common"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const transfers = railTransfers(legs);
  // The train on screen lists its originals in the page's own Documents
  // section, which can upload and delete; a second list here would go stale
  // the moment the user uploads there (review 2026-10-08, minor 2).
  const { byLeg, retry } = useRailLegDocuments(
    legs.filter((leg) => leg.id !== currentId).map((leg) => leg.id)
  );

  return (
    <div className="flex flex-col gap-2">
      {pnr && showPnr && <p className="t-caption">{t("rail:connection.booking", { pnr })}</p>}
      <ol className="flex flex-col gap-2" data-testid="rail-connection-legs">
        {legs.map((leg, index) => {
          const label = `${index + 1}. ${leg.depStationName} → ${leg.arrStationName}`;
          const train = trainLabel({
            trainCategory: leg.trainCategory,
            trainNumber: leg.trainNumber,
            operator: leg.operator ?? null,
          });
          const when = formatRailSpan(leg, locale);
          return (
            <li key={leg.id} className="text-sm" data-testid={`rail-connection-leg-${leg.id}`}>
              {index > 0 && (
                <RailTransferNote
                  transfer={transfers[index - 1]}
                  arriving={legs[index - 1]}
                  departing={leg}
                  index={index}
                />
              )}
              {leg.id === currentId ? (
                <strong aria-current="page">{label}</strong>
              ) : (
                <Link to={`/rail/${leg.id}`} className={`font-semibold underline ${TOUCH_LINK}`}>
                  {label}
                </Link>
              )}
              <p className="t-caption">
                {[when, train, t(`rail:status.${leg.status}`)].filter(Boolean).join(" · ")}
              </p>
              <p data-testid={`rail-connection-leg-${leg.id}-seat`}>
                {seatLine(leg, pnr, t).join(" · ")}
              </p>
              {leg.id === currentId ? (
                <p className="t-caption" data-testid={`rail-connection-leg-${leg.id}-documents`}>
                  {t("rail:connectionView.documentsBelow")}
                </p>
              ) : (
                <LegDocumentsLine
                  legId={leg.id}
                  documents={byLeg.get(leg.id) ?? { state: "loading" }}
                  onRetry={(): void => retry(leg.id)}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Class, coach and seat (or that none is recorded), and a reference of the leg's own. */
function seatLine(leg: RailCompactLeg, pnr: string | null, t: Translate): string[] {
  const reservation = [
    leg.coach ? t("rail:connectionView.coach", { coach: leg.coach }) : null,
    leg.seat ? t("rail:connectionView.seat", { seat: leg.seat }) : null,
  ].filter((part): part is string => part !== null);
  const ownReference = leg.bookingReference && leg.bookingReference !== pnr;
  return [
    leg.travelClass ? t(`rail:class.${leg.travelClass}`) : null,
    reservation.length > 0 ? reservation.join(", ") : t("rail:connectionView.noReservation"),
    ownReference ? t("rail:connectionView.reference", { reference: leg.bookingReference }) : null,
  ].filter((part): part is string => part !== null);
}

function LegDocumentsLine({
  legId,
  documents,
  onRetry,
}: {
  legId: string;
  documents: LegDocuments;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useTranslation(["rail", "documents", "common"]);
  const testId = `rail-connection-leg-${legId}-documents`;
  if (documents.state === "loading") {
    return (
      <p className="t-caption" data-testid={testId}>
        {t("rail:connectionView.documentsLoading")}
      </p>
    );
  }
  if (documents.state === "failed") {
    return (
      <p className="text-xs text-(--danger)" role="alert" data-testid={testId}>
        {t("rail:connectionView.documentsFailed")}{" "}
        <button type="button" className={`underline ${TOUCH_LINK}`} onClick={onRetry}>
          {t("common:buttons.retry")}
        </button>
      </p>
    );
  }
  if (documents.documents.length === 0) {
    return (
      <p className="t-caption" data-testid={testId}>
        {t("rail:connectionView.noDocuments")}
      </p>
    );
  }
  return (
    <p className="text-sm" data-testid={testId}>
      <span className="t-caption">{t("rail:connectionView.documents")} </span>
      {documents.documents.map((doc, index) => (
        <Fragment key={doc.id}>
          {index > 0 && ", "}
          <a
            // A plain link, as the documents section does: the JWT is an
            // HttpOnly cookie, and a top-level navigation carries it.
            href={documentFileUrl(doc)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("documents:openLabel", { name: doc.displayName })}
            className={`underline ${TOUCH_LINK}`}
          >
            {doc.displayName}
            {doc.kind ? ` (${t(`documents:kind.${doc.kind}`)})` : ""}
          </a>
        </Fragment>
      ))}
    </p>
  );
}
