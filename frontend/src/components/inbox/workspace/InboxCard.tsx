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
import JourneySuggestionCard from "./JourneySuggestionCard";
import VisitSuggestionCard from "../visitReview/VisitSuggestionCard";
import type { VisitReviewState } from "../visitReview/useVisitReview";
import { photoJourneyLabel } from "../photoJourneyLabel";
import { isCardPhotoJourney } from "../../../types/photoJourney";
import type { InboxAction } from "./FlagQuickEditor";
import { useToastStore } from "../../../store/toastStore";

export default function InboxCard({
  item,
  disabled,
  reload,
  stayChoices,
  visitReview,
}: {
  item: InboxItem;
  disabled: boolean;
  reload: () => Promise<void>;
  stayChoices: StayChoices;
  /** Shared by every visit card and the batch bar, so a selection spans cards. */
  visitReview: VisitReviewState;
}) {
  const { t } = useTranslation(["dataQuality", "common"]);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCheckFailed, setSavedCheckFailed] = useState(false);
  const addToast = useToastStore((state) => state.addToast);
  const act: InboxAction = async (operation, recheck = false, done) => {
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
      if (done) addToast("success", done);
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
      {item.source === "photos" &&
        (isCardPhotoJourney(item.data) ? (
          <PhotoProposalCard journey={item.data} busy={working} act={act} />
        ) : (
          <VisitSuggestionCard
            embedded
            journey={item.data}
            label={photoJourneyLabel(item.data)}
            selected={visitReview.selected.has(item.data.id)}
            busy={disabled || visitReview.busy.has(item.data.id)}
            correction={visitReview.corrections[item.data.id] ?? {}}
            failure={visitReview.failures.find((failure) => failure.id === item.data.id)}
            onToggle={() => visitReview.toggle(item.data.id)}
            onCorrect={(next) => visitReview.correct(item.data.id, next)}
            onAccept={() => void visitReview.answer([item.data.id], "accept")}
            onDismiss={() => void visitReview.answer([item.data.id], "dismiss")}
          />
        ))}
      {item.source === "dawarich" && (
        <fieldset disabled={disabled} className="min-w-0">
          <StayReviewCard row={item.data} choices={stayChoices} onDone={() => void reload()} />
        </fieldset>
      )}
      {item.source === "location" && item.data.kind === "journey" && (
        <JourneySuggestionCard suggestion={item.data} disabled={disabled} reload={reload} />
      )}
      {busy && (
        <p role="status" className="mt-3 t-caption">
          {t(`${W}.working`)}
        </p>
      )}
    </div>
  );
}
