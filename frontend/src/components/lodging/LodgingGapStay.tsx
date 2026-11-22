import { useEffect, useState } from "react";
import type { JSX } from "react";
import GapEntityPicker from "../gap/GapEntityPicker";
import { StayEditor } from "./StayEditor";
import { useGapPrefill } from "../../hooks/useGapPrefill";
import { useTranslation } from "../../hooks/useTranslation";
import { listLodgingPage } from "../../lib/api/lodging";
import type { GapDates } from "../../lib/gapCalendar";
import type { Lodging } from "../../types/lodging";

/**
 * The gap calendar's "Eintrag anlegen" on the lodging list (`?addFrom=&addTo=`): which
 * house the stay belongs to — searched on the server, with "new house" as the way out —
 * and then the stay editor on the gap's days. A first day that was not a real one opens
 * the ordinary add chooser instead.
 */
export function LodgingGapStay({
  onCreateHouse,
  onReload,
}: {
  onCreateHouse: () => void;
  onReload: () => void | Promise<void>;
}): JSX.Element | null {
  const { t } = useTranslation(["track"]);
  const gap = useGapPrefill();
  const [picking, setPicking] = useState<GapDates | null>(null);
  const [stay, setStay] = useState<{ lodging: Lodging; dates: GapDates } | null>(null);

  useEffect(() => {
    if (!gap.request) return;
    if (gap.request.dates) setPicking(gap.request.dates);
    else onCreateHouse();
    gap.done();
    // `onCreateHouse` is the page's setter closure; the request is what triggers this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap]);

  return (
    <>
      {picking && (
        <GapEntityPicker<Lodging>
          title={t("track:gaps.lodgingPicker.title")}
          hint={t("track:gaps.lodgingPicker.hint", { from: picking.from, to: picking.to })}
          searchLabel={t("track:gaps.lodgingPicker.search")}
          search={async (q) =>
            (await listLodgingPage({ search: q || undefined, limit: 20, offset: 0 })).rows.map(
              (l) => ({ id: l.id, name: l.name, detail: l.city, data: l })
            )
          }
          onPick={(pick) => {
            setStay({ lodging: pick.data, dates: picking });
            setPicking(null);
          }}
          createLabel={t("track:gaps.lodgingPicker.create")}
          onCreate={() => {
            setPicking(null);
            onCreateHouse();
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {stay && (
        <StayEditor
          mode="create"
          lodgingId={stay.lodging.id}
          lodgingName={stay.lodging.name}
          lodgingChainId={stay.lodging.chainId}
          lodgingCountryCode={stay.lodging.isoCountryCode}
          initialDates={stay.dates}
          afterSaveFailedKey="common:form.savedButRefreshFailed"
          onClose={() => setStay(null)}
          onReload={() => void onReload()}
          onSaved={async () => {
            setStay(null);
            await onReload();
          }}
        />
      )}
    </>
  );
}
