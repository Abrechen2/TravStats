import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import TripPeopleSection from "./TripPeopleSection";
import { useRemoteShareBlock } from "./useRemoteShareBlock";

/**
 * The one "Teilen …" dialog of a trip (owner, 2026-11-20): "Personen" — the
 * trip's companions, people on other servers and the invitation code in one
 * place, so nobody has to know which server somebody lives on — and the
 * public link. The parts are the existing ones: the people section brings its
 * rows, its "link to an account" actions and the offer controls; the two
 * buttons open the companion and link dialogs the head used to open directly.
 *
 * Why other-server sharing is not possible here is said in the people
 * section, not in the menu.
 */
export default function TripShareDialog({
  tripId,
  companionNames,
  onClose,
  onChanged,
  onPick,
}: {
  tripId: string;
  companionNames: readonly string[];
  onClose: () => void;
  onChanged: () => void;
  onPick: (which: "link" | "companions") => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const remoteBlock = useRemoteShareBlock(tripId, true);

  return (
    <Dialog open title={t("sharing:menu.button")} maxWidth={620} onClose={onClose}>
      <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
        <section
          aria-labelledby="trip-share-people"
          className="flex flex-col"
          style={{ gap: "var(--ts-space-md)" }}
        >
          <h3 id="trip-share-people" className="t-label-mono">
            {t("sharing:tripShare.people")}
          </h3>
          <p className="t-caption">{t("sharing:tripShare.peopleHint")}</p>
          <TripPeopleSection
            bare
            tripId={tripId}
            companionNames={companionNames}
            onChanged={onChanged}
          />
          <div>
            <button
              type="button"
              className="t-caption underline"
              onClick={() => onPick("companions")}
            >
              {t("sharing:tripShare.addLocal")}
            </button>
          </div>
          {remoteBlock && (
            <p data-testid="remote-share-blocked" className="t-caption">
              {t(`sharing:menu.remoteBlocked.${remoteBlock}`)}
            </p>
          )}
        </section>
        <section
          aria-labelledby="trip-share-link"
          className="flex flex-col"
          style={{ gap: "var(--ts-space-md)" }}
        >
          <h3 id="trip-share-link" className="t-label-mono">
            {t("sharing:menu.link")}
          </h3>
          <p className="t-caption">{t("sharing:tripShare.linkHint")}</p>
          <div>
            <Button onClick={() => onPick("link")}>{t("sharing:tripShare.createLink")}</Button>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
