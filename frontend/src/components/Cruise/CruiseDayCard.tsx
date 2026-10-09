import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatLocalClock, formatLocalDate } from "../../lib/displayFormat";
import { documentFileUrl } from "../../lib/api/documents";
import type { EffectiveTimelineEntry } from "./cruisePorts";
import { documentsOfDay, portStay } from "./cruiseDayCardModel";
import type { CruiseDocumentsState } from "./useCruiseDocuments";

interface Props {
  entry: EffectiveTimelineEntry;
  isToday: boolean;
  documents: CruiseDocumentsState;
  onRetryDocuments: () => void;
  /**
   * Bumped when the reader picks a day: the card may sit far above the row
   * that was tapped on a long itinerary, so it is brought into view and takes
   * the focus (review I5). 0 — the card opened by itself on "today" — moves
   * nothing.
   */
  focusRequest?: number;
}

const LINK_CLASS =
  "underline underline-offset-2 hover:text-(--text-primary) pointer-coarse:inline-flex pointer-coarse:min-h-(--ts-size-touch-min) items-center";

function duration(minutes: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("dayCard.minutes", { count: rest });
  return rest === 0
    ? t("dayCard.hours", { count: hours })
    : t("dayCard.hoursMinutes", { hours, minutes: rest });
}

/**
 * One day of the cruise on one card (forgejo#223): the port, how long the ship
 * lies there, the time to be back on board, the excursion and the originals
 * dated that day — what a passenger looks up on the gangway.
 *
 * Every time is the PORT's clock and every date the port's day (ADR 0002),
 * marked "Ortszeit". A time that is not recorded says "offen" — the card never
 * fills a gap, least of all the all-aboard time from the departure.
 */
export function CruiseDayCard({
  entry,
  isToday,
  documents,
  onRetryDocuments,
  focusRequest = 0,
}: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (focusRequest === 0) return;
    const heading = headingRef.current;
    if (!heading) return;
    heading.scrollIntoView?.({ block: "nearest" });
    heading.focus({ preventScroll: true });
  }, [focusRequest]);
  const stop = entry.stop;
  const stay = stop ? portStay(stop) : { arrive: null, depart: null, minutes: null };
  const place = entry.isAtSea
    ? t("stops.at_sea")
    : entry.port
      ? [entry.port.name, entry.port.country].filter(Boolean).join(", ")
      : `${entry.unresolvedPortName ?? "—"} (${t("stops.unresolved")})`;
  const allAboard = stop?.allAboardTime ?? null;
  const ofDay = documents.status === "ready" ? documentsOfDay(documents.documents, entry.date) : [];

  return (
    <section
      aria-labelledby="cruise-day-card-title"
      className="mb-4 rounded-lg border border-(--ts-domain-cruise) p-3"
      style={{ background: "var(--bg-surface)" }}
    >
      <h3
        ref={headingRef}
        tabIndex={-1}
        id="cruise-day-card-title"
        className="flex flex-wrap items-center gap-2 text-sm font-semibold text-(--text-primary)"
      >
        {stop ? `${t("detail.day")} ${stop.dayNumber}` : null}
        {entry.date ? <span>· {formatLocalDate(entry.date)}</span> : null}
        {isToday && (
          <span className="rounded-full bg-(--ts-domain-cruise) px-2 py-0.5 text-xs text-(--bg-base)">
            {t("dayCard.today")}
          </span>
        )}
      </h3>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-(--text-muted)">{t("dayCard.port")}</dt>
        <dd className="text-(--text-primary)">{place}</dd>

        {!entry.isAtSea && (
          <>
            <dt className="text-(--text-muted)">{t("dayCard.inPort")}</dt>
            <dd className="text-(--text-primary)">
              {t("dayCard.inPortTimes", {
                arrive: stay.arrive ? formatLocalClock(stay.arrive) : t("dayCard.open"),
                depart: stay.depart ? formatLocalClock(stay.depart) : t("dayCard.open"),
              })}
              {stay.minutes !== null && <> ({duration(stay.minutes, t)})</>}
            </dd>

            <dt className="text-(--text-muted)">{t("dayCard.allAboard")}</dt>
            <dd className="text-(--text-primary)">
              {allAboard ? (
                t("dayCard.localTime", { time: formatLocalClock(allAboard) })
              ) : (
                <span className="text-(--text-muted)">{t("dayCard.allAboardOpen")}</span>
              )}
            </dd>
          </>
        )}

        <dt className="text-(--text-muted)">{t("dayCard.excursion")}</dt>
        <dd className="whitespace-pre-wrap text-(--text-primary)">
          {entry.excursionNote?.trim() ? (
            entry.excursionNote
          ) : (
            <span className="text-(--text-muted)">{t("dayCard.noExcursion")}</span>
          )}
        </dd>

        <dt className="text-(--text-muted)">{t("dayCard.documents")}</dt>
        <dd className="text-(--text-primary)">
          {documents.status === "loading" && (
            <span className="text-(--text-muted)">{t("dayCard.documentsLoading")}</span>
          )}
          {documents.status === "failed" && (
            <span role="alert" className="text-(--danger)">
              {t("dayCard.documentsFailed")}{" "}
              <button type="button" onClick={onRetryDocuments} className={LINK_CLASS}>
                {t("common:buttons.retry")}
              </button>
            </span>
          )}
          {documents.status === "ready" &&
            (ofDay.length > 0 ? (
              <>
                {/* Matched by the date printed on them, not filed with the
                    day — so the card says what it knows (review M4). */}
                <span className="text-xs text-(--text-muted)">{t("dayCard.documentsDated")}</span>
                <ul className="flex flex-col gap-1">
                  {ofDay.map((d) => (
                    <li key={d.id}>
                      <a
                        href={documentFileUrl(d)}
                        target="_blank"
                        rel="noreferrer"
                        className={LINK_CLASS}
                      >
                        {d.displayName}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <span className="text-(--text-muted)">
                {t("dayCard.noDocuments", { count: documents.documents.length })}
              </span>
            ))}
        </dd>
      </dl>
      <p className="mt-2 text-xs text-(--text-muted)">{t("dayCard.localNote")}</p>
    </section>
  );
}
