import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { TimeValueFlagDetails } from "../../types/dataQuality";
import { fieldLabel, reasonLabel } from "../Admin/timeModel/timeModelCopy";
import { isTimeFlagEntityType, timeValueEditorPath, type TimeFlagKind } from "./timeFlagLinks";

/**
 * The body of a time flag (ADR 0002, plan Phase 3b): which value the
 * migration could not convert, why, and the one way to answer — the editor
 * where the missing zone or time of day is supplied.
 *
 * Unlike the other kinds there are no two values to weigh, so there is no
 * pair of equal boxes: there is a gap and a button to the place that fills it.
 * When the record it lives under cannot be reached, the card says so instead
 * of offering a link that opens nothing.
 */
export default function TimeValueFlag({
  kind,
  entityType,
  entityId,
  details,
}: {
  kind: TimeFlagKind;
  entityType: string;
  entityId: string;
  details: TimeValueFlagDetails;
}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "admin"]);
  const format = useDisplayFormat();
  const path = isTimeFlagEntityType(entityType)
    ? timeValueEditorPath(entityType, entityId, details.parentId, kind)
    : null;

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>
        {t(`dataQuality:kinds.${kind}.question`)}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt style={{ color: "var(--text-muted)" }}>{t("dataQuality:time.field")}</dt>
        <dd>{fieldLabel(t, details.field)}</dd>
        <dt style={{ color: "var(--text-muted)" }}>{t("dataQuality:time.reason")}</dt>
        <dd>{reasonLabel(t, details.reason)}</dd>
        {details.localDay && (
          <>
            <dt style={{ color: "var(--text-muted)" }}>{t("dataQuality:time.day")}</dt>
            {/* A calendar day, not an instant: formatted in UTC so the
                viewer's own zone cannot move it to the day before. */}
            <dd>{format.date(details.localDay, { timeZone: "UTC" })}</dd>
          </>
        )}
      </dl>
      {path ? (
        <Link to={path} className="btn-secondary inline-block">
          {t(`dataQuality:time.action.${kind}.${entityType}`)}
        </Link>
      ) : (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("dataQuality:time.noEditor")}
        </p>
      )}
    </div>
  );
}
