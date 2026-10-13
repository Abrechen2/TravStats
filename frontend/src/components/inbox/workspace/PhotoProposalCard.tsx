import { useRef, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { photoJourneysApi } from "../../../lib/api/photoJourneys";
import type { PhotoJourney, CardPhotoJourney } from "../../../types/photoJourney";
import {
  createFromPhotoJourney,
  linkPhotoJourney,
  type PhotoJourneyCreated,
} from "../acceptPhotoJourney";
import PhotoJourneyPreviewStrip from "../PhotoJourneyPreviewStrip";
import { photoJourneyPlan } from "../photoJourneyPlan";
import { photoJourneyLabel } from "../photoJourneyLabel";
import { photoJourneySpan } from "../photoJourneySpan";
import { useDisplayFormat } from "../../../lib/displayFormat";
import VisitSuggestionCorrection from "../visitReview/VisitSuggestionCorrection";
import {
  buildReviewItems,
  needsName,
  visitAcceptPlan,
  type VisitCorrection,
} from "../visitReview/reviewItems";
import Button from "../../ui/Button";
import type { InboxAction } from "./FlagQuickEditor";
import { useToastStore } from "../../../store/toastStore";
import { W } from "./model";

const NS = "dataQuality:inbox.photoJourneys";
export default function PhotoProposalCard({
  journey,
  busy,
  act,
}: {
  journey: PhotoJourney;
  busy: boolean;
  act: InboxAction;
}) {
  const { t } = useTranslation(["dataQuality"]);
  const format = useDisplayFormat();
  const addToast = useToastStore((state) => state.addToast);
  const [correction, setCorrection] = useState<VisitCorrection>({});
  const [name, setName] = useState(photoJourneyLabel(journey));
  const [start, setStart] = useState(journey.startDay ?? "");
  const [end, setEnd] = useState(journey.endDay ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  // Survives view/filter changes: the workspace keeps each card mounted by key.
  const created = useRef<PhotoJourneyCreated | null>(null);
  const visit = journey.kind === "visit";
  const plan = visit ? null : photoJourneyPlan(journey as CardPhotoJourney);
  const valid = visit
    ? !needsName(journey, correction)
    : plan !== "trip" || Boolean(name.trim() && start && end && end >= start);
  const accept = () =>
    void act(async () => {
      setNotice(null);
      if (visit) {
        const result = await photoJourneysApi.review(
          buildReviewItems([journey.id], "accept", [journey], { [journey.id]: correction })
        );
        const row = result.results.find((r) => r.id === journey.id);
        if (!row || row.outcome === "failed") {
          setNotice(
            row?.outcome === "failed" ? t(`${NS}.review.failure.${row.code}`) : t(`${W}.saveFailed`)
          );
          throw new Error("Photo review failed");
        }
        if (row.outcome === "accepted" && row.photos?.kind === "failed")
          addToast("warning", t(`${NS}.messages.photosNotLinked`));
      } else {
        if (!created.current)
          created.current = await createFromPhotoJourney(
            {
              ...journey,
              ...(plan === "trip" ? { startDay: start, endDay: end } : {}),
            } as CardPhotoJourney,
            name.trim()
          );
        try {
          const outcome = await linkPhotoJourney(journey.id, created.current);
          if (outcome?.kind === "failed") addToast("warning", t(`${NS}.messages.photosNotLinked`));
        } catch {
          setNotice(t(`${W}.photoLinkFailed`));
          throw new Error("Photo link failed");
        }
      }
    });
  return (
    <div className="space-y-3">
      <p className="text-sm">{photoJourneySpan(journey, format)}</p>
      <p className="t-caption">
        {t(`${W}.photoEvidence`, { photos: journey.photoCount, located: journey.locatedCount })}
      </p>
      <PhotoJourneyPreviewStrip journey={journey} />
      {journey.nearestVisit?.withinReach && (
        <p role="note" className="text-sm text-(--ts-warn)">
          {t(`${NS}.review.alreadyVisited`, { name: journey.nearestVisit.placeName })}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy || created.current !== null} className="min-w-0 space-y-3">
        {visit && (
          <VisitSuggestionCorrection
            journey={journey}
            correction={correction}
            onChange={setCorrection}
          />
        )}
        {plan === "trip" && (
          <>
            <label className="block text-sm">
              {t(`${W}.tripName`)}
              <input
                className="input mt-1 w-full"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                {t(`${W}.start`)}
                <input
                  type="date"
                  className="input mt-1 w-full"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label className="text-sm">
                {t(`${W}.end`)}
                <input
                  type="date"
                  className="input mt-1 w-full"
                  value={end}
                  min={start}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
          </>
        )}
      </fieldset>
      <p className="t-caption">
        {visit
          ? t(`${NS}.review.creates.${visitAcceptPlan(journey, correction)}`, {
              name: correction.place?.name ?? "",
            })
          : t(`${NS}.creates.${plan}`)}
      </p>
      {!valid && <p className="t-caption">{t(`${W}.completeFields`)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !valid} onClick={accept}>
          {t(`${W}.acceptPhoto.${visit ? "visit" : plan}`)}
        </Button>
        <Button
          disabled={busy || created.current !== null}
          onClick={() => void act(() => photoJourneysApi.dismiss(journey.id))}
        >
          {t(`${W}.dismissPhoto`)}
        </Button>
      </div>
    </div>
  );
}
