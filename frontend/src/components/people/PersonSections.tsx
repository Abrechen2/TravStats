import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import type { CompanionUseKind, PersonTimeline } from "../../lib/api/companions";
import { Card } from "../ui";
import { composeI18nText } from "../evidence/evidenceText";
import { formatDayLong } from "../../shared/time";

const NS = "companions:person";

/** A day, or the em dash — an unknown day is never printed as a date. */
export function useDay(): (day: string | null) => string {
  const { i18n } = useTranslation(["companions"]);
  return (day) => (day ? formatDayLong(day, i18n.language) : "—");
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}): JSX.Element {
  return (
    <Card data-testid={testId}>
      <h2 className="t-label-mono" style={{ marginBottom: "var(--ts-space-md)" }}>
        {title}
      </h2>
      {children}
    </Card>
  );
}

/** The figures; a null one says "unknown" in words, not 0. */
export function SummaryCards({ summary }: { summary: PersonTimeline["summary"] }): JSX.Element {
  const { t } = useTranslation(["companions"]);
  const day = useDay();
  const figure = (label: string, value: number | null): JSX.Element => (
    <div className="flex flex-col" style={{ gap: 2, minWidth: 120 }}>
      <span className="t-caption">{label}</span>
      <span className="text-xl font-semibold">{value === null ? t(`${NS}.unknown`) : value}</span>
    </div>
  );
  return (
    <Card data-testid="person-summary">
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-xl)" }}>
        <div className="flex flex-col" style={{ gap: 2, minWidth: 160 }}>
          <span className="t-caption">{t(`${NS}.first`)}</span>
          <span className="text-xl font-semibold">{day(summary.firstTogether)}</span>
        </div>
        <div className="flex flex-col" style={{ gap: 2, minWidth: 160 }}>
          <span className="t-caption">{t(`${NS}.last`)}</span>
          <span className="text-xl font-semibold">{day(summary.lastTogether)}</span>
        </div>
        {figure(t(`${NS}.trips`), summary.trips)}
        {figure(t(`${NS}.flights`), summary.flights)}
        {figure(t(`${NS}.nights`), summary.nights)}
        {figure(t(`${NS}.countries`), summary.countries)}
        {figure(t(`${NS}.days`), summary.days)}
      </div>
      <p className="t-caption" style={{ marginTop: "var(--ts-space-md)", maxWidth: "80ch" }}>
        {t(`${NS}.rule`)}
      </p>
    </Card>
  );
}

export function TimelineList({ rows }: { rows: PersonTimeline["timeline"] }): JSX.Element {
  const { t } = useTranslation(["companions", "evidence"]);
  const day = useDay();
  return (
    <Section title={t(`${NS}.timeline`)} testId="person-timeline-list">
      {rows.length === 0 ? (
        <p className="t-caption">{t(`${NS}.emptyTimeline`)}</p>
      ) : (
        <ol className="flex flex-col" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((row) => {
            const title =
              composeI18nText(row.title, t) ||
              t(`companions:manage.kinds.${row.kind}`, { count: 1 });
            const sub = composeI18nText(row.subtitle, t);
            const when =
              row.from === null
                ? t(`${NS}.undated`)
                : row.to && row.to !== row.from
                  ? `${day(row.from)} – ${day(row.to)}`
                  : day(row.from);
            return (
              <li
                key={`${row.kind}:${row.id}`}
                className="flex flex-wrap items-baseline pointer-coarse:min-h-(--ts-size-touch-min)"
                style={{
                  gap: "var(--ts-space-md)",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--ts-border)",
                }}
                data-testid={`person-row-${row.kind}-${row.id}`}
              >
                <span className="t-caption" style={{ minWidth: 190 }}>
                  {when}
                </span>
                <span className="t-caption" style={{ minWidth: 90 }}>
                  {t(`${NS}.kind.${row.kind}`)}
                </span>
                {row.href ? (
                  <Link to={row.href} className="font-semibold underline">
                    {title}
                  </Link>
                ) : (
                  <span className="font-semibold">{title}</span>
                )}
                {sub && <span className="t-caption">{sub}</span>}
                {row.state === "planned" && (
                  <span
                    className="t-caption"
                    data-testid="person-planned"
                    style={{ color: "var(--ts-warn)" }}
                  >
                    {t(`${NS}.planned`)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

export function DocumentsList({ docs }: { docs: PersonTimeline["documents"] }): JSX.Element {
  const { t } = useTranslation(["companions", "documents"]);
  return (
    <Section title={t(`${NS}.documents`)} testId="person-documents">
      {docs.length === 0 ? (
        <p className="t-caption">{t(`${NS}.emptyDocuments`)}</p>
      ) : (
        <ul className="flex flex-col" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-baseline"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <span className="font-semibold">{d.name ?? t(`${NS}.unnamed`)}</span>
              {d.kind && (
                <span className="t-caption">
                  {t(`documents:kind.${d.kind}`, { defaultValue: d.kind })}
                </span>
              )}
              {d.entry.href && (
                <Link to={d.entry.href} className="t-caption underline">
                  {t(`${NS}.kind.${d.entry.kind}`)}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function FactsList({ facts }: { facts: PersonTimeline["facts"] }): JSX.Element {
  const { t } = useTranslation(["companions", "evidence"]);
  const day = useDay();
  const kindName = (k: CompanionUseKind): string => t(`${NS}.kind.${k}`);
  return (
    <Section title={t(`${NS}.facts`)} testId="person-facts">
      <h3 className="t-caption">{t(`${NS}.seats`)}</h3>
      {facts.seats.length === 0 ? (
        <p className="t-caption">{t(`${NS}.emptySeats`)}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 var(--ts-space-md)" }}>
          {facts.seats.map((s) => (
            <li
              key={`${s.kind}:${s.id}`}
              className="flex flex-wrap items-baseline"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <span className="t-caption" style={{ minWidth: 190 }}>
                {day(s.day)}
              </span>
              <span className="font-semibold">
                {[s.seat, s.seatClass].filter(Boolean).join(" · ")}
              </span>
              {s.href ? (
                <Link to={s.href} className="t-caption underline">
                  {composeI18nText(s.title, t) || kindName(s.kind)}
                </Link>
              ) : (
                <span className="t-caption">{composeI18nText(s.title, t) || kindName(s.kind)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3 className="t-caption">{t(`${NS}.loyalty`)}</h3>
      {facts.loyalty.length === 0 ? (
        <p className="t-caption">{t(`${NS}.emptyLoyalty`)}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }}>
          {facts.loyalty.map((l) => (
            <li
              key={l.number}
              className="flex flex-wrap items-baseline"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <span className="font-semibold">{l.number}</span>
              <span className="t-caption">{l.kinds.map(kindName).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
