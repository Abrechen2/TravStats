import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import { listPlaceSuggestions, type SmartSuggestion } from "../../../lib/api/smartLists";
import { SuggestionRow } from "./SuggestionRow";
import InlineError from "../../ui/InlineError";

/**
 * "Were you here on …?" on the place's own page: the unanswered TravTrack stops at this place.
 * The same suggestions the stay inbox holds — one answer answers both. A failed read says so
 * instead of showing no suggestion.
 */
export default function PlaceVisitSuggestions({
  placeId,
  onAnswered,
}: {
  placeId: string;
  /** A confirmed one adds a visit: the page re-reads. */
  onAnswered: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["places"]);
  const [rows, setRows] = useState<SmartSuggestion[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await listPlaceSuggestions(placeId));
      setFailed(false);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceVisitSuggestions: could not read the suggestions");
      setFailed(true);
    }
  }, [placeId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <InlineError>{t("places:smartList.loadFailed")}</InlineError>;
  if (rows.length === 0) return null;
  return (
    <section aria-label={t("places:smartList.placeSectionTitle")}>
      <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {t("places:smartList.placeSectionTitle")}
      </h2>
      <ul className="grid gap-2" style={{ listStyle: "none", padding: 0 }}>
        {rows.map((row) => (
          <SuggestionRow
            key={row.id}
            suggestion={row}
            onAnswered={() => {
              void load();
              onAnswered();
            }}
          />
        ))}
      </ul>
    </section>
  );
}
