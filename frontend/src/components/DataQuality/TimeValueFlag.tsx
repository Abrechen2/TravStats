import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useTranslation } from "../../hooks/useTranslation";
import { type DisplayFormatter, useDisplayFormat } from "../../lib/displayFormat";
import type { DomainKey } from "../../shared/domains";
import { useSettingsStore } from "../../store/settingsStore";
import type { DataQualityFlag } from "../../types/dataQuality";
import type { TimeFlagEntityType, TimeFlagKind } from "../../types/timeMigration";
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

/**
 * Reasons whose kept value is a calendar day stored as a placeholder instant
 * (a date-only flight): shown as a DAY, never with the placeholder's clock —
 * "31.03.2009 22:00 (America/New_York)" under a sentence saying the stored day
 * was kept was the Beta finding (2.7.0-beta.16). The day is the one the flight
 * page shows: the local day of the instant in the row's zone, because a
 * date-only flight is written as a local wall clock through that zone
 * (forgejo#273, `shared/time/dateOnlyFlights.json`); the stored UTC date only
 * without a zone. Its UTC date was the day before for a cruise-import flight
 * east of UTC, beside a flight page showing the right one.
 */
const KEPT_AS_DAY: ReadonlySet<string> = new Set(["date_only_day_differs"]);

/**
 * Reasons whose kept value has a day but no known time of day: the record
 * shows the date only, so a clock here ("12.05.2024 00:00") would be one
 * nobody entered.
 */
const KEPT_WITHOUT_TIME: ReadonlySet<string> = new Set([
  "writer_unknown",
  "semantics_unknown",
  "local_time_nonexistent",
]);

function keptText(
  value: string,
  zone: string | null,
  reason: string,
  format: DisplayFormatter
): string {
  if (!DAY_ONLY.test(value) && !Number.isNaN(Date.parse(value))) {
    if (KEPT_AS_DAY.has(reason)) return format.date(value, { timeZone: zone ?? "UTC" });
    if (KEPT_WITHOUT_TIME.has(reason) && zone) {
      return `${format.date(value, { timeZone: zone })} (${zone})`;
    }
  }
  return storedText(value, zone, format);
}

/**
 * The domain whose pages hold the editor for a row; null where the editor is
 * never behind a domain switch (trips, the profile).
 */
const DOMAIN_OF: Record<TimeFlagEntityType, DomainKey | null> = {
  flight: "flight",
  rail_journey: "rail",
  place_visit: "poi",
  cruise: "cruise",
  cruise_stop: "cruise",
  lodging_stay: "lodging",
  trip: null,
  trip_stop: null,
  trip_journal_entry: null,
  profile: null,
};

export default function TimeValueFlag({
  flag,
}: {
  flag: DataQualityFlag & { kind: TimeFlagKind };
}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "admin", "dashboard"]);
  const format = useDisplayFormat();
  const path = timeFlagEditorPath(flag);
  // A question about a switched-off domain would link to a page that only says
  // "Bereich deaktiviert" (measured: 47 visit questions in an account with
  // places off). Only once the reader's domains are known — before that the
  // store holds a placeholder list.
  const domainsLoaded = useSettingsStore((s) => s.enabledDomainsLoaded) === true;
  const { isEnabled } = useEnabledDomains();
  const domain = DOMAIN_OF[flag.entityType as TimeFlagEntityType] ?? null;
  const domainOff = domainsLoaded && domain !== null && !isEnabled(domain);
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
              <dd>{keptText(field.keptValue, field.zone, field.reason, format)}</dd>
            </>
          )}
        </dl>
      ))}
      {domainOff && domain ? (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("dataQuality:time.domainOff", {
              domain: t(`dashboard:tabStrip.tabs.${domain}`),
            })}
          </p>
          <Link to="/settings#modules" className="btn-secondary inline-block">
            {t("dataQuality:time.domainOffAction")}
          </Link>
        </div>
      ) : path ? (
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
