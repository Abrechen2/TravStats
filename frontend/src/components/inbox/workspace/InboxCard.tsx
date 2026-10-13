import { useRef, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { dataQualityFlagsApi } from "../../../lib/api/dataQualityFlags";
import { tripSuggestionErrorKey, isStale } from "../tripSuggestionCopy";
import type { InboxItem } from "./model";
import StayReviewCard from "../../dawarich/StayReviewCard";
import type { StayChoices } from "../../../lib/api/dawarichStays";
import { W } from "./model";
import ReviewCard from "./ReviewCard";
import TripProposalCard from "./TripProposalCard";
import FlightUpdateCard from "./FlightUpdateCard";
import PhotoProposalCard from "./PhotoProposalCard";
import type { InboxAction } from "./FlagQuickEditor";

export default function InboxCard({
  item,
  disabled,
  reload,
  stayChoices,
}: {
  item: InboxItem;
  disabled: boolean;
  reload: () => Promise<void>;
  stayChoices: StayChoices;
}) {
  const { t } = useTranslation(["dataQuality", "common"]);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCheckFailed, setSavedCheckFailed] = useState(false);
  const act: InboxAction = async (operation, recheck = false) => {
    if (lock.current || disabled) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    setSavedCheckFailed(false);
    try {
      await operation();
      if (recheck) {
        try {
          await dataQualityFlagsApi.run();
        } catch {
          setSavedCheckFailed(true);
        }
      }
      await reload();
      return true;
    } catch (failure) {
      setError(t(tripSuggestionErrorKey(failure, `${W}.saveFailed`)));
      if (isStale(failure)) await reload();
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const working = busy || disabled;
  return (
    <div aria-busy={busy}>
      {error && (
        <p role="alert" className="mb-3 text-sm text-(--ts-bad)">
          {error}
        </p>
      )}
      {savedCheckFailed && (
        <p role="alert" className="mb-3 text-sm text-(--ts-warn)">
          {t(`${W}.savedCheckFailed`)}
        </p>
      )}
      {disabled && (
        <p role="status" className="mb-3 t-caption">
          {t(`${W}.staleSource`)}
        </p>
      )}
      {item.source === "review" && <ReviewCard flag={item.data} busy={working} act={act} />}
      {item.source === "trips" && (
        <TripProposalCard suggestion={item.data} busy={working} act={act} />
      )}
      {item.source === "updates" && (
        <FlightUpdateCard update={item.data} busy={working} act={act} />
      )}
      {item.source === "photos" && (
        <PhotoProposalCard journey={item.data} busy={working} act={act} />
      )}
      {item.source === "dawarich" && (
        <fieldset disabled={disabled} className="min-w-0">
          <StayReviewCard row={item.data} choices={stayChoices} onDone={() => void reload()} />
        </fieldset>
      )}
      {busy && (
        <p role="status" className="mt-3 t-caption">
          {t(`${W}.working`)}
        </p>
      )}
    </div>
  );
}
