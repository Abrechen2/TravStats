import { JSX } from "react";
import { DOMAINS, type DomainKey } from "../../shared/domains";
import { formatDateInTimezone } from "../../lib/dateUtils";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useTranslation } from "../../hooks/useTranslation";

export interface TimelineEvent {
  id: string;
  domain: DomainKey;
  date: string; // ISO date
  title: string;
  subtitle?: string;
  meta?: string;
}

export interface TripTimelineProps {
  events: TimelineEvent[];
}

export default function TripTimeline({ events }: TripTimelineProps): JSX.Element {
  const { t } = useTranslation(["common"]);
  const { colorOf } = useDomainColors();
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ol className="flex flex-col gap-3 relative" style={{ listStyle: "none", paddingLeft: 0 }}>
      {sorted.map((ev) => {
        const d = DOMAINS[ev.domain];
        return (
          <li
            key={ev.id}
            className="flex items-start gap-3 p-3 rounded-lg"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div
              data-testid="timeline-event-badge"
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `${colorOf(ev.domain)}22`,
                color: colorOf(ev.domain),
                fontSize: "18px",
              }}
              aria-label={t(d.i18nKey)}
            >
              {d.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div
                data-testid="timeline-event-title"
                className="font-semibold truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {ev.title}
              </div>
              {ev.subtitle && (
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {ev.subtitle}
                </div>
              )}
              {ev.meta && (
                <div
                  className="text-xs mt-1"
                  style={{ color: "var(--text-muted)", fontFamily: "ui-monospace, monospace" }}
                >
                  {ev.meta}
                </div>
              )}
            </div>
            <time
              className="text-xs shrink-0"
              style={{ color: "var(--text-muted)" }}
              dateTime={ev.date}
            >
              {formatDateInTimezone(ev.date, "UTC")}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
