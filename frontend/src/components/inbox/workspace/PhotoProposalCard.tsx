import { useRef, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { photoJourneysApi } from "../../../lib/api/photoJourneys";
import type { CardPhotoJourney } from "../../../types/photoJourney";
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
import Button from "../../ui/Button";
import type { InboxAction } from "./FlagQuickEditor";
import { useToastStore } from "../../../store/toastStore";
import { W } from "./model";

const NS = "dataQuality:inbox.photoJourneys";

/**
 * A trip, place or stay the photo library suggests. A `visit` finding is not
 * drawn here: visits are answered through `VisitSuggestionCard`, which can also
 * answer several at once (forgejo#211, O5).
 *
 * Accepting is create-then-link (`acceptPhotoJourney.ts`). What the create made
 * is kept in a ref until the row is gone, so a retry after a failed link links
 * the same trip instead of creating a second one.
 */
export default function PhotoProposalCard({
  journey,
  busy,
  act,
}: {
  journey: CardPhotoJourney;
  busy: boolean;
  act: InboxAction;
}) {
  const { t } = useTranslation(["dataQuality"]);
  const format = useDisplayFormat();
  const addToast = useToastStore((state) => state.addToast);
  const [name, setName] = useState(photoJourneyLabel(journey));
  const [start, setStart] = useState(journey.startDay ?? "");
  const [end, setEnd] = useState(journey.endDay ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  // Survives view/filter changes: the workspace keeps each card mounted by key.
  const created = useRef<PhotoJourneyCreated | null>(null);
  const plan = photoJourneyPlan(journey);
  const valid = plan !== "trip" || Boolean(name.trim() && start && end && end >= start);
  const facts = [
    journey.nights ? t(`${NS}.facts.nights`, { nights: journey.nights }) : null,
    journey.airportIata ? t(`${NS}.facts.airport`, { iata: journey.airportIata }) : null,
  ].filter((fact): fact is string => fact !== null);
  const accept = () =>
    void act(async () => {
      setNotice(null);
      if (!created.current)
        created.current = await createFromPhotoJourney(
          { ...journey, ...(plan === "trip" ? { startDay: start, endDay: end } : {}) },
          name.trim()
        );
      try {
        const outcome = await linkPhotoJourney(journey.id, created.current);
        addToast("success", t(`${NS}.messages.accepted.${created.current.kind}`));
        if (outcome?.kind === "linked" && outcome.linked > 0)
          addToast("success", t(`${NS}.messages.photosLinked`, { count: outcome.linked }));
        else if (outcome?.kind === "failed")
          addToast("warning", t(`${NS}.messages.photosNotLinked`));
      } catch {
        setNotice(t(`${W}.photoLinkFailed`));
        throw new Error("Photo link failed");
      }
    });
  return (
    <div className="space-y-3">
      <p className="text-sm">{photoJourneySpan(journey, format)}</p>
      <p className="t-caption">
        {t(`${W}.photoEvidence`, { photos: journey.photoCount, located: journey.locatedCount })}
        {facts.length > 0 && ` · ${facts.join(" · ")}`}
      </p>
      <PhotoJourneyPreviewStrip journey={journey} />
      {notice && <p role="status">{notice}</p>}
      {plan === "trip" && (
        <fieldset disabled={busy || created.current !== null} className="min-w-0 space-y-3">
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
        </fieldset>
      )}
      <p className="t-caption">{t(`${NS}.creates.${plan}`)}</p>
      {!valid && <p className="t-caption">{t(`${W}.completeFields`)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !valid} onClick={accept}>
          {t(`${W}.acceptPhoto.${plan}`)}
        </Button>
        <Button
          disabled={busy || created.current !== null}
          onClick={() =>
            void act(
              () => photoJourneysApi.dismiss(journey.id),
              false,
              t(`${NS}.messages.dismissed`)
            )
          }
        >
          {t(`${W}.dismissPhoto`)}
        </Button>
      </div>
    </div>
  );
}
