import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import {
  companionsApi,
  type CompanionTogether,
  type CompanionUseKind,
} from "../../../lib/api/companions";
import { logger } from "../../../lib/logger";
import { dateLocaleForLanguage } from "../../../lib/units";
import EvidenceTrigger from "../EvidenceTrigger";
import CountingHelp from "../counting/CountingHelp";

/** How many people the section shows before "Alle anzeigen". */
const TOP = 8;

const NS = "stats:companionsTogether";

/**
 * "Mit wem unterwegs" (owner, 2026-10-22): per companion, all time, the days
 * spent together across every domain the reader sees — a day two shared
 * entries cover counts once — the shared entries per kind and the countries
 * visited together by the passport's rule. Each figure opens its evidence
 * (`companion:<figure>:<id>`), so the reader can see which entries made it.
 *
 * The server decides the population and the domain gating
 * (`GET /companions/together`). A country count the server could not derive
 * (only trips or rentals together) says so in words, never as 0. A failed load says so in one line; the rest of the overview stands.
 */
export default function CompanionsTogetherSection(): JSX.Element | null {
  const { t, i18n } = useTranslation(["stats", "companions"]);
  const [data, setData] = useState<{
    companions: CompanionTogether[];
    kinds: CompanionUseKind[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    companionsApi
      .together()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err: unknown) => {
        logger.error("CompanionsTogetherSection: fetch failed", err);
        if (!cancelled) setFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const locale = dateLocaleForLanguage(i18n.language);
  const shown = data ? (all ? data.companions : data.companions.slice(0, TOP)) : [];

  return (
    <section data-testid="companions-together">
      <div
        className="flex flex-wrap items-baseline gap-3 mb-3"
        style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: 8 }}
      >
        <h2
          className="text-xs uppercase tracking-widest font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          {t(`${NS}.title`)}
        </h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t(`${NS}.hint`)}
        </span>
      </div>
      {failed && (
        <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
          {t(`${NS}.loadFailed`)}
        </p>
      )}
      {data && data.companions.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t(`${NS}.empty`)}
        </p>
      )}
      {shown.length > 0 && (
        <ol className="flex flex-col gap-2">
          {shown.map((row, index) => (
            <CompanionRow
              key={row.id}
              row={row}
              rank={index + 1}
              kinds={data?.kinds ?? []}
              locale={locale}
            />
          ))}
        </ol>
      )}
      {data && data.companions.length > TOP && (
        <button
          type="button"
          className="mt-3 text-sm underline"
          style={{ color: "var(--text-muted)" }}
          onClick={() => setAll((v) => !v)}
        >
          {all
            ? t(`${NS}.showTop`, { count: TOP })
            : t(`${NS}.showAll`, { count: data.companions.length })}
        </button>
      )}
      {shown.length > 0 && (
        <CountingHelp
          testId="companions-together-help"
          entries={[
            { term: t(`${NS}.helpTerms.days`), helpKey: `${NS}.help.days` },
            { term: t(`${NS}.helpTerms.entries`), helpKey: `${NS}.help.entries` },
            { term: t(`${NS}.helpTerms.countries`), helpKey: `${NS}.help.countries` },
          ]}
        />
      )}
    </section>
  );
}

function CompanionRow({
  row,
  rank,
  kinds,
  locale,
}: {
  row: CompanionTogether;
  rank: number;
  kinds: CompanionUseKind[];
  locale: string;
}): JSX.Element {
  const { t } = useTranslation(["stats", "companions"]);
  const coarse = useCoarsePointer();
  const figure = (key: string, value: number, text: string): JSX.Element => (
    <EvidenceTrigger
      key={key}
      kind="ranking"
      evidenceKey={`companion:${key}:${row.id}`}
      scope={{ period: "allTime" }}
      renderedValue={value}
      label={`${row.name}: ${text}`}
      className="rounded-full px-3 text-sm underline decoration-dotted underline-offset-2"
      style={{
        width: "auto",
        minHeight: coarse ? 44 : 28,
        background: "var(--ts-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      {text}
    </EvidenceTrigger>
  );
  const perKind = kinds.filter((kind) => (row.perKind[kind] ?? 0) > 0);
  return (
    <li
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{ border: "1px solid var(--color-border)" }}
      data-testid={`companion-together-${row.id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {rank}. {row.name}
        </span>
        {figure(
          "days",
          row.days,
          t(`${NS}.days`, { count: row.days, value: row.days.toLocaleString(locale) })
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {figure(
          "entries",
          row.entries,
          t(`${NS}.entries`, { count: row.entries, value: row.entries.toLocaleString(locale) })
        )}
        {perKind.map((kind) =>
          figure(
            kind,
            row.perKind[kind] ?? 0,
            t(`companions:manage.kinds.${kind}`, { count: row.perKind[kind] })
          )
        )}
        {row.countries === null ? (
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t(`${NS}.countriesUnknown`)}
          </span>
        ) : (
          figure(
            "countries",
            row.countries,
            t(`${NS}.countries`, {
              count: row.countries,
              value: row.countries.toLocaleString(locale),
            })
          )
        )}
      </div>
    </li>
  );
}
