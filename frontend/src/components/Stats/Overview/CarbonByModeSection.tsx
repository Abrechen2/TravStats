import type { JSX } from "react";
import { useEffect, useState } from "react";
import { statsApi } from "../../../lib/api/stats";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainVisible } from "../../../hooks/useDomainVisible";
import { logger } from "../../../lib/logger";
import { dateLocaleForLanguage } from "../../../lib/units";
import type { DomainKey } from "../../../shared/domains";
import type { Co2ModeStats, Co2Stats } from "../../../types/co2";
import StatCard from "../StatCard";
import CountingHelp from "../counting/CountingHelp";

const MODE_DOMAIN: Record<Co2ModeStats["mode"], DomainKey> = {
  rail: "rail",
  bus: "bus",
  ferry: "ferry",
  cruise: "cruise",
  rental: "rental",
};

const EVIDENCE_KEY: Record<Co2ModeStats["mode"], string> = {
  rail: "co2RailKg",
  bus: "co2BusKg",
  ferry: "co2FerryKg",
  cruise: "co2CruiseKg",
  rental: "co2RentalKg",
};

/**
 * Carbon per mode of travel (forgejo#395), lifetime. Every mode is its own
 * figure with its coverage ("3 of 5 rides measured") and a jump to the records
 * behind it; the total is a sentence naming its parts, not a tile, because the
 * parts rest on different bases. A mode with nothing measurable shows "–",
 * never 0, and an estimate says so.
 */
export default function CarbonByModeSection(): JSX.Element | null {
  const { t, i18n } = useTranslation(["stats", "common"]);
  const locale = dateLocaleForLanguage(i18n.language);
  const flightOn = useDomainVisible("flight");
  const railOn = useDomainVisible("rail");
  const busOn = useDomainVisible("bus");
  const ferryOn = useDomainVisible("ferry");
  const cruiseOn = useDomainVisible("cruise");
  const rentalOn = useDomainVisible("rental");
  const visible: Partial<Record<DomainKey, boolean>> = {
    flight: flightOn,
    rail: railOn,
    bus: busOn,
    ferry: ferryOn,
    cruise: cruiseOn,
    rental: rentalOn,
  };
  const [data, setData] = useState<Co2Stats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await statsApi.getCo2();
        if (!cancelled) setData(result);
      } catch (err) {
        logger.error("CarbonByModeSection: fetch failed", err);
        if (!cancelled) setFailed(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  if (failed || data === null) return null;
  const modes = data.modes.filter((m) => visible[MODE_DOMAIN[m.mode]] === true && m.records > 0);
  const showFlights = visible.flight === true && data.flights.records > 0;
  if (modes.length === 0 && !showFlights) return null;

  const kg = (n: number): string => `${Math.round(n).toLocaleString(locale)} kg`;
  const coverage = (m: { measured: number; records: number }): string =>
    t("stats:carbon.coverage", { measured: m.measured, records: m.records });
  const parts = [
    ...(showFlights && data.flights.kg !== null
      ? [`${t("common:co2.modes.flight")} ${kg(data.flights.kg)}`]
      : []),
    ...modes.flatMap((m) =>
      m.kg === null ? [] : [`${t(`common:co2.modes.${m.mode}`)} ${kg(m.kg)}`]
    ),
  ];
  const saved = data.savedVsFlightKg;

  return (
    <section className="mt-8" data-testid="carbon-by-mode">
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("stats:carbon.title")}
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        {t("stats:carbon.subtitle")}
      </p>
      {data.totalKg !== null && parts.length > 1 && (
        <p className="mb-4 text-sm" style={{ color: "var(--text-primary)" }}>
          {t("stats:carbon.total", { total: kg(data.totalKg) })} {parts.join(" + ")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {showFlights && (
          <StatCard
            title={t("common:co2.modes.flight")}
            value={data.flights.kg === null ? "–" : `≈ ${kg(data.flights.kg)}`}
            description={coverage(data.flights)}
            valueSize="md"
            evidence={
              data.flights.kg === null
                ? undefined
                : {
                    kind: "metric",
                    key: "co2FootprintKg",
                    scope: { period: "allTime" },
                    renderedValue: Math.round(data.flights.kg),
                  }
            }
          />
        )}
        {modes.map((m) => (
          <StatCard
            key={m.mode}
            title={t(`common:co2.modes.${m.mode}`)}
            value={m.kg === null ? "–" : `${m.lowerBound ? "≥" : "≈"} ${kg(m.kg)}`}
            description={coverage(m)}
            footnote={m.mode === "cruise" ? t("stats:carbon.cruiseNote") : undefined}
            valueSize="md"
            evidence={
              m.kg === null
                ? undefined
                : {
                    kind: "metric",
                    key: EVIDENCE_KEY[m.mode],
                    scope: { period: "allTime" },
                    renderedValue: Math.round(m.kg),
                  }
            }
          />
        ))}
        {saved !== null && (
          <StatCard
            title={t("stats:carbon.saved")}
            value={`≈ ${kg(saved)}`}
            description={t("stats:carbon.savedDescription", { count: data.comparedRides })}
            valueSize="md"
            evidence={{
              kind: "metric",
              key: "co2SavedVsFlightKg",
              scope: { period: "allTime" },
              renderedValue: Math.round(saved),
            }}
          />
        )}
      </div>
      <CountingHelp
        entries={[
          { term: t("stats:carbon.helpTerms.perMode"), helpKey: "stats:carbon.help.perMode" },
          { term: t("stats:carbon.saved"), helpKey: "stats:carbon.help.saved" },
        ]}
      />
      <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("stats:carbon.source", { publisher: data.source.publisher, year: data.source.year })}
      </p>
    </section>
  );
}
