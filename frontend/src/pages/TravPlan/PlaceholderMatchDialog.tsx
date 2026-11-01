import { useState } from "react";
import { Button, Dialog, StatusPill } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import type { PlaceholderMatch, PlanBooking } from "../../lib/api/travplan";
import { PlanActions, PlanRow } from "./planLayout";

/**
 * Import review (spec §5.2, board 8): an imported booking that looks like a placeholder the plan
 * holds. The best match is shown field by field (changed / new); the traveller replaces the
 * placeholder, adds the booking as an additional one, or looks at the next candidate.
 */
export function PlaceholderMatchDialog({
  booking,
  matches,
  placeholders,
  busy,
  onReplace,
  onAdd,
  onClose,
}: {
  booking: PlanBooking;
  matches: PlaceholderMatch[];
  placeholders: PlanBooking[];
  busy: boolean;
  onReplace: (placeholderId: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("travplan"),
    [at, setAt] = useState(0),
    match = matches[at % matches.length],
    placeholder = placeholders.find((p) => p.id === match.bookingId);
  return (
    <Dialog open onClose={onClose} busy={busy} title={t("match.title")}>
      <p className="t-body">
        {t("match.intro", { booking: booking.title, placeholder: placeholder?.title ?? "" })}
      </p>
      {match.variant === "inactive" && <p className="t-caption">{t("match.inactiveVariant")}</p>}
      <div role="table" aria-label={t("match.table")}>
        {match.differences.length ? (
          match.differences.map((d) => (
            <PlanRow key={d.field}>
              <span role="rowheader" className="t-caption" style={{ minWidth: "8rem" }}>
                {t("match.field." + d.field)}
              </span>
              <span className="t-body">
                {d.plan ?? t("review.unknown")} → {d.booking}
              </span>
              <StatusPill status={d.change === "new" ? "flown" : "scheduled"}>
                {t("match.change." + d.change)}
              </StatusPill>
            </PlanRow>
          ))
        ) : (
          <p className="t-body">{t("match.identical")}</p>
        )}
      </div>
      <PlanActions>
        <Button variant="primary" disabled={busy} onClick={() => onReplace(match.bookingId)}>
          {t("match.replace")}
        </Button>
        <Button disabled={busy} onClick={onAdd}>
          {t("match.addAdditional")}
        </Button>
        {matches.length > 1 && (
          <Button disabled={busy} onClick={() => setAt((i) => i + 1)}>
            {t("match.another", { n: (at % matches.length) + 1, total: matches.length })}
          </Button>
        )}
        <Button disabled={busy} onClick={onClose}>
          {t("cancel")}
        </Button>
      </PlanActions>
    </Dialog>
  );
}
