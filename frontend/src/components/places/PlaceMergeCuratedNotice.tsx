import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { listCuratedChecklists } from "../../lib/api/placeLists";
import { curatedText } from "../../lib/curatedCopy";
import { logger } from "../../lib/logger";
import type { CuratedListSummary } from "../../types/placeList";

/** The checklist a curated item belongs to — the id is `<listKey>:<item>`. */
export function checklistKeyOf(curatedItemId: string): string {
  return curatedItemId.split(":")[0] ?? curatedItemId;
}

/** Two places that each stand for a DIFFERENT checklist item cannot become one. */
export function curatedPair(
  a: { curatedItemId: string | null },
  b: { curatedItemId: string | null }
): boolean {
  return (
    a.curatedItemId !== null && b.curatedItemId !== null && a.curatedItemId !== b.curatedItemId
  );
}

/**
 * Why these two stay apart, said the moment the duplicate is picked (review
 * I4) — not after every group has been decided and "Zusammenführen" pressed.
 *
 * `Place.curatedItemId` is one column, and checklist progress counts places by
 * it: merged, one of the two ticks would be gone. The catalogue makes this the
 * likeliest duplicate of all for a checklist user — 38 objects sit on two
 * lists (Petra on UNESCO-Welterbe and the New 7 Wonders …), and ticking both
 * creates two places. The server's 409 stays as the guard.
 */
export function PlaceMergeCuratedNotice({
  keptName,
  otherName,
  keptItem,
  otherItem,
  onPickAnother,
  pickAnotherId,
}: {
  keptName: string;
  otherName: string;
  keptItem: string;
  otherItem: string;
  onPickAnother: () => void;
  pickAnotherId: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["places"]);
  const [catalogue, setCatalogue] = useState<CuratedListSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listCuratedChecklists();
        if (!cancelled) setCatalogue(rows);
      } catch (err: unknown) {
        // The rule is said either way; only the lists' names fall back to keys.
        logger.error({ err }, "PlaceMergeCuratedNotice: could not load the checklists");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nameOf = (key: string): string => {
    const list = catalogue.find((c) => c.key === key);
    return list ? curatedText(list.name, list.nameEn, i18n.language) : key;
  };
  const keptList = checklistKeyOf(keptItem);
  const otherList = checklistKeyOf(otherItem);

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg p-3 text-sm"
      style={{ border: "1px solid color-mix(in srgb, var(--ts-warn) 45%, transparent)" }}
    >
      <p>
        {keptList === otherList
          ? t("places:merge.curated.sameList", {
              kept: keptName,
              other: otherName,
              list: nameOf(keptList),
            })
          : t("places:merge.curated.twoLists", {
              kept: keptName,
              other: otherName,
              lists: `${nameOf(keptList)}, ${nameOf(otherList)}`,
            })}
      </p>
      <button
        id={pickAnotherId}
        type="button"
        onClick={onPickAnother}
        className="self-start underline pointer-coarse:min-h-(--ts-size-touch-min)"
      >
        {t("places:merge.pickOther")}
      </button>
    </div>
  );
}
