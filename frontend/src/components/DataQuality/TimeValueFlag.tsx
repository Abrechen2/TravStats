import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { type DisplayFormatter, useDisplayFormat } from "../../lib/displayFormat";
import type { DataQualityFlag } from "../../types/dataQuality";
import type { TimeFlagKind } from "../../types/timeMigration";
import { columnLabelForUser, reasonLabel } from "../Admin/timeModel/timeModelCopy";
import { timeFlagEditorPath } from "./timeFlagLinks";

/**
 * The body of a time question (ADR 0002, plan Phase 3b): which value the
 * migration left open, why, what is stored and what was kept, and the one way
 * to answer — the editor where the zone, the time of day or the day is set.
 *
 * Unlike the other kinds there are no two values to weigh, so there is no
 * pair of equal boxes: there is a gap and a button to the place that fills
 * it. When the record it lives under cannot be reached, the card says so
 * instead of offering a link that opens nothing.
 */

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A stored value as its digits, never re-read in the viewer's zone. A day is
 * a day; an instant with a known zone is shown in that zone; one without a
 * zone is shown exactly as stored (UTC digits) — the label says there is no
 * zone, which is the whole question. A value that is not a date at all (a
 * raw time of day) is shown as it is.
 */
function storedText(value: string, zone: string | null, format: DisplayFormatter): string {
  if (DAY_ONLY.test(value)) return format.date(value, { timeZone: "UTC" });
  if (Number.isNaN(Date.parse(value))) return value;
  return zone
    ? `${format.dateTime(value, { timeZone: zone })} (${zone})`
    : format.dateTime(value, { timeZone: "UTC" });
}

export default function TimeValueFlag({
  flag,
}: {
  flag: DataQualityFlag & { kind: TimeFlagKind };
}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "admin"]);
  const format = useDisplayFormat();
  const path = timeFlagEditorPath(flag);
  const actionKey =
    flag.entityType === "place_visit" && flag.kind === "time_zone_unresolved"
      ? "place_visit_zone"
      : flag.entityType;

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>
        {t(`dataQuality:kinds.${flag.kind}.question`)}
      </p>
      {flag.details.fields.map((field) => (
        <dl
          key={field.column}
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg p-3 text-sm"
          style={{ background: "var(--bg-base)", border: "1px solid var(--color-border)" }}
        >
          <dt style={{ color: "var(--text-muted)" }}>{t("dataQuality:time.field")}</dt>
          <dd>{columnLabelForUser(t, field.column)}</dd>
          <dt style={{ color: "var(--text-muted)" }}>{t("dataQuality:time.reason")}</dt>
          <dd>{reasonLabel(t, field.reason)}</dd>
          {field.legacyValue && (
            <>
              <dt style={{ color: "var(--text-muted)" }}>{t("dataQuality:time.stored")}</dt>
              <dd>{storedText(field.legacyValue, null, format)}</dd>
            </>
          )}
          {field.keptValue && (
            <>
              <dt style={{ color: "var(--text-muted)" }}>{t("dataQuality:time.kept")}</dt>
              <dd>{storedText(field.keptValue, field.zone, format)}</dd>
            </>
          )}
        </dl>
      ))}
      {path ? (
        <Link to={path} className="btn-secondary inline-block">
          {t(`dataQuality:time.action.${actionKey}`)}
        </Link>
      ) : (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("dataQuality:time.noEditor")}
        </p>
      )}
    </div>
  );
}
