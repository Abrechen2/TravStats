import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import type { TripSuggestionList } from "../../../types/tripSuggestion";
import DawarichStayScanCard from "../../Settings/DawarichStayScanCard";
import { Card } from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import PhotoScanPanel from "./PhotoScanPanel";
import type { InboxSource } from "./model";

const TRIPS = "dataQuality:inbox.tripSuggestions";

/** Each kind's own "nothing waiting" copy — the one the old per-kind tab printed. */
const EMPTY: Record<Exclude<InboxSource, "photos">, { title: string; description: string }> = {
  review: {
    title: "dataQuality:inbox.review.empty.title",
    description: "dataQuality:inbox.review.empty.description",
  },
  trips: { title: `${TRIPS}.empty.title`, description: `${TRIPS}.empty.description` },
  updates: {
    title: "pendingUpdates:empty.title",
    description: "pendingUpdates:empty.description",
  },
  dawarich: { title: "trips:dawarichStays.title", description: "trips:dawarichStays.empty" },
  location: {
    title: "dataQuality:inbox.workspace.location.emptyTitle",
    description: "dataQuality:inbox.workspace.location.emptyDescription",
  },
};

/**
 * What belongs to one kind of item rather than to one card: its description,
 * its own controls (the photo and GPS scans), the trip engine's caveats, and —
 * once the kind has loaded and holds nothing — its own empty state.
 *
 * `empty` is only ever a measured empty: the caller passes it after the kind
 * loaded without failing, so a failed load never reads as "nothing to do".
 */
export default function SourcePanel({
  source,
  empty,
  proposalInfo,
  reload,
}: {
  source: InboxSource | "all";
  empty: boolean;
  proposalInfo: TripSuggestionList | null;
  reload: () => Promise<void>;
}) {
  const { t } = useTranslation(["dataQuality", "pendingUpdates", "trips"]);
  const showTripNotes = (source === "all" || source === "trips") && proposalInfo;
  return (
    <div className="space-y-3">
      {source === "trips" && <p className="t-caption">{t(`${TRIPS}.description`)}</p>}
      {source === "updates" && (
        <p className="t-caption">{t("dataQuality:inbox.flightUpdates.description")}</p>
      )}
      {source === "dawarich" && <DawarichStayScanCard onScanned={() => void reload()} />}
      {showTripNotes && proposalInfo.home === "missing" && (
        <p role="status" className="t-caption text-(--ts-warn)">
          {t(`${TRIPS}.home.missing`)}{" "}
          <Link className="underline" to="/settings?section=homeAirport">
            {t(`${TRIPS}.home.link`)}
          </Link>
        </p>
      )}
      {showTripNotes && proposalInfo.home === "estimated" && (
        <p className="t-caption">{t(`${TRIPS}.home.estimated`)}</p>
      )}
      {showTripNotes && proposalInfo.total > proposalInfo.suggestions.length && (
        <p className="t-caption">
          {t(`${TRIPS}.capped`, {
            shown: proposalInfo.suggestions.length,
            total: proposalInfo.total,
          })}
        </p>
      )}
      {showTripNotes && proposalInfo.truncated && (
        <p className="t-caption">{t(`${TRIPS}.truncated`)}</p>
      )}
      {source === "photos" && <PhotoScanPanel empty={empty} onScanned={reload} />}
      {empty && source !== "photos" && source !== "all" && (
        <Card flush>
          <EmptyState
            kind="pending"
            title={t(EMPTY[source].title)}
            description={t(EMPTY[source].description)}
          />
        </Card>
      )}
    </div>
  );
}
