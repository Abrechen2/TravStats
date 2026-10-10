import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { DataQualityFlag, RelatedRecord } from "../../types/dataQuality";

import Side from "./FlagSide";
import { recordPath } from "./recordFlagLinks";

/**
 * The record checks' questions (forgejo#282): a possible duplicate, two
 * entries that overlap, a missing flight number, an unknown airport, a trip
 * whose dates do not hold its entries.
 *
 * Same rule as every flag: **a question, not a verdict.** Nothing here offers
 * to delete or merge. Each question names the records involved and links to
 * them — the safe answer (delete the extra copy, correct a date, fill a field)
 * is given on the record's own page, where the user sees what they change.
 */

function RelatedLink({ record }: { record: RelatedRecord }): JSX.Element {
  const { t } = useTranslation(["dataQuality"]);
  const path = recordPath(record);
  const label = record.label || t("dataQuality:flag.unnamedRecord");
  return path ? (
    <Link to={path} className="text-sm underline" style={{ color: "var(--accent)" }}>
      {label}
    </Link>
  ) : (
    <span className="text-sm">{label}</span>
  );
}

function Question({ children }: { children: string }): JSX.Element {
  return (
    <p className="text-sm" style={{ color: "var(--text-primary)" }}>
      {children}
    </p>
  );
}

function Hint({ children }: { children: string }): JSX.Element {
  return (
    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}

export default function RecordCheckFlag({ flag }: { flag: DataQualityFlag }): JSX.Element | null {
  const { t } = useTranslation(["dataQuality"]);
  const fmt = useDisplayFormat();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`dataQuality:kinds.${flag.kind}.${key}`, options);
  const span = (from: string, to: string) => `${fmt.localDate(from)} – ${fmt.localDate(to)}`;

  switch (flag.kind) {
    case "duplicate_candidate": {
      const fields = flag.details.matchedOn
        .map((field) => t(`dataQuality:kinds.duplicate_candidate.fields.${field}`))
        .join(", ");
      const source = (value: string | null) =>
        value
          ? t(`dataQuality:kinds.duplicate_candidate.sources.${value}`, { defaultValue: value })
          : t("dataQuality:kinds.duplicate_candidate.sources.unknown");
      return (
        <div className="space-y-3">
          <Question>{k("question", { fields })}</Question>
          <Hint>{k("thisSource", { source: source(flag.details.dataSource) })}</Hint>
          <div>
            <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              {k("copiesTitle")}
            </div>
            <ul className="space-y-1">
              {flag.details.copies.map((copy) => (
                <li key={copy.entityId}>
                  <RelatedLink record={copy} />{" "}
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {k("copyMeta", {
                      source: source(copy.dataSource),
                      date: fmt.date(copy.createdAt),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <Hint>{k("safePath")}</Hint>
        </div>
      );
    }

    case "chronology_conflict": {
      const d = flag.details;
      const isFlight = d.domain === "flight";
      const range = (from: string, to: string) =>
        isFlight ? `${fmt.dateTime(from)} – ${fmt.dateTime(to)}` : span(from, to);
      return (
        <div className="space-y-3">
          <Question>
            {isFlight
              ? k("questionFlight", { minutes: d.overlapMinutes ?? 0 })
              : k("questionStay", { count: d.overlapNights ?? 0 })}
          </Question>
          <div className="flex flex-wrap gap-3">
            <Side label={k("this")} value={range(d.thisStart, d.thisEnd)} />
            <Side label={k("other")} value={range(d.otherStart, d.otherEnd)} />
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {k("otherLink")} <RelatedLink record={d.conflictWith} />
          </div>
          <Hint>{k("safePath")}</Hint>
        </div>
      );
    }

    case "flight_number_missing":
      return (
        <div className="space-y-3">
          <Question>{k("question", { airline: flag.details.airline })}</Question>
          <Hint>{k("safePath")}</Hint>
        </div>
      );

    case "airport_unknown":
      return (
        <div className="space-y-3">
          <Question>{k("question")}</Question>
          <div className="flex flex-wrap gap-3">
            {flag.details.endpoints.map((end) => (
              <Side
                key={end.side}
                label={k(`side.${end.side}`)}
                value={[end.iata, end.icao].filter(Boolean).join(" / ")}
                note={end.name ?? undefined}
              />
            ))}
          </div>
          <Hint>{k("safePath")}</Hint>
        </div>
      );

    case "trip_end_missing":
      return (
        <div className="space-y-3">
          <Question>{k("question", { start: fmt.localDate(flag.details.startDay) })}</Question>
          {flag.details.lastEntryDay && (
            <Hint>{k("suggestion", { day: fmt.localDate(flag.details.lastEntryDay) })}</Hint>
          )}
          <Hint>{k("safePath")}</Hint>
        </div>
      );

    case "trip_entries_outside":
      return (
        <div className="space-y-3">
          <Question>
            {k("question", { span: span(flag.details.startDay, flag.details.endDay) })}
          </Question>
          <ul className="space-y-1">
            {flag.details.entries.map((entry) => (
              <li key={`${entry.entityType}-${entry.entityId}`}>
                <RelatedLink record={entry} />{" "}
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {entry.firstDay === entry.lastDay
                    ? fmt.localDate(entry.firstDay)
                    : span(entry.firstDay, entry.lastDay)}
                </span>
              </li>
            ))}
          </ul>
          <Hint>{k("safePath")}</Hint>
        </div>
      );

    default:
      return null;
  }
}
