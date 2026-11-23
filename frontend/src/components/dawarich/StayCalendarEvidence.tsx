import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { toLocal } from "../../shared/time/zone";
import type { StayCalendarEvidence as Evidence } from "../../lib/api/dawarichStays";

/**
 * Why a calendar event belongs to this stop (spec 2026-11-23-plugins-and-
 * calendar.md, P2): its title, time and calendar, and how it matched — a place
 * (geocoded, a place's name, a rule's place) or context only. An answered
 * finding keeps only the span, so the card then says just that.
 */
export default function StayCalendarEvidence({
  evidence,
  zone,
}: {
  evidence: Evidence;
  zone: string;
}): JSX.Element {
  const { t } = useTranslation(["suggestionSources"]);
  const time = (iso: string) => toLocal(iso, zone).local.replace("T", " ").slice(0, 16);
  return (
    <div className="t-caption" data-testid="stay-calendar-evidence">
      <p>
        {t("suggestionSources:inbox.calendar.source", { label: evidence.sourceLabel ?? "" })}
        {evidence.title ? ` · ${evidence.title}` : ""}
      </p>
      <p>
        {time(evidence.start)} – {time(evidence.end)}
        {evidence.location ? ` · ${evidence.location}` : ""}
      </p>
      {evidence.match && (
        <p>
          {t(`suggestionSources:inbox.calendar.match.${evidence.match}`, {
            meters: evidence.geocoded?.distanceM ?? 0,
          })}
          {evidence.timeMatch
            ? ` · ${t(`suggestionSources:inbox.calendar.time.${evidence.timeMatch}`, {
                minutes: evidence.overlapMinutes ?? 0,
              })}`
            : ""}
        </p>
      )}
    </div>
  );
}
