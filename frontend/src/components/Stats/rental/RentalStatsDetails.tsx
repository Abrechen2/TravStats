import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../../hooks/useTranslation";
import type { RentalExtraStats, RentalStats } from "../../../lib/api/rentalLinks";
import { formatAmount } from "../../../lib/units";
import type { SectionVisibility } from "../../../hooks/useSectionVisibility";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import StatCard from "../StatCard";
import RankedBarList, { type RankedRow } from "../lodging/RankedBarList";
import CountingHelp from "../counting/CountingHelp";

export type RentalEvidence = (
  key: string,
  renderedValue: number | null
) => { kind: "metric"; key: string; scope: EvidenceScopeParams; renderedValue: number | null };

/**
 * The rental blocks forgejo#262 adds: one-way rentals and brokers, efficiency
 * over one documented subset, booked against billed, vehicles and records.
 * Every figure is the server's (`extra` in `GET /rentals/stats`,
 * `services/rental/rentalStatsExtra.ts`); nothing is counted or converted
 * here. Where a block has nothing to stand on, its empty line names the data
 * that would fill it — an invoice, an odometer reading — and asks for nothing
 * the user does not already keep.
 */
export default function RentalStatsDetails({
  stats,
  extra,
  accent,
  visibility,
  evidence,
}: {
  stats: RentalStats;
  extra: RentalExtraStats;
  accent: string;
  visibility: SectionVisibility;
  evidence: RentalEvidence;
}): JSX.Element {
  const { t, i18n } = useTranslation(["rental"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const num = (n: number, digits = 0): string =>
    n.toLocaleString(locale, { maximumFractionDigits: digits });
  const money = (amount: number, currency: string): string =>
    formatAmount(amount, currency, { language: i18n.language });
  const show = visibility.isVisible;
  const { kmPerDay, costPerKm, bookedVsFinal, vehicles, records } = extra;

  const brokerRows: RankedRow[] = stats.brokers.map((b) => ({
    key: b.broker,
    label: b.broker,
    weight: b.rentals,
    value: String(b.rentals),
  }));
  const classRows: RankedRow[] = vehicles.classes.map((c) => ({
    key: c.label,
    label: c.label,
    weight: c.rentals,
    value: String(c.rentals),
  }));

  return (
    <>
      {show("brokers") && (
        <div data-testid="rental-brokers">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rental:stats.oneWay")}
              value={num(stats.oneWay)}
              description={t("rental:stats.oneWayDesc")}
              evidence={evidence("rentalOneWayCount", stats.oneWay)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rental:stats.viaBroker")}
              value={num(extra.brokered.viaBroker)}
              description={t("rental:stats.directDesc", { count: extra.brokered.direct })}
              evidence={evidence("rentalBrokeredCount", extra.brokered.viaBroker)}
            />
            <RankedBarList
              title={t("rental:stats.brokers")}
              rows={brokerRows}
              accent={accent}
              emptyLabel={t("rental:stats.noBrokers")}
            />
          </div>
          <CountingHelp
            entries={[
              { term: t("rental:stats.oneWay"), helpKey: "rental:stats.help.oneWay" },
              { term: t("rental:stats.brokers"), helpKey: "rental:stats.help.brokers" },
            ]}
          />
        </div>
      )}

      {show("efficiency") && (
        <div data-testid="rental-efficiency">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rental:stats.kmPerDay")}
              value={kmPerDay.value === null ? "–" : `${num(kmPerDay.value, 1)} km`}
              description={
                kmPerDay.value === null
                  ? t("rental:stats.kmPerDayNone")
                  : t("rental:stats.kmPerDaySample", {
                      count: kmPerDay.rentals,
                      km: num(kmPerDay.km),
                      days: kmPerDay.days,
                    })
              }
              // A ratio: its entries are the rentals it stands on.
              evidence={evidence("rentalKmPerDaySampleCount", kmPerDay.rentals)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rental:stats.costPerKm")}
              value={
                costPerKm.length === 0
                  ? "–"
                  : costPerKm.map((c) => money(c.perKm, c.currency)).join(" · ")
              }
              description={
                costPerKm.length === 0
                  ? t("rental:stats.costPerKmNone")
                  : t("rental:stats.costPerKmSample", {
                      count: costPerKm.reduce((n, c) => n + c.rentals, 0),
                    })
              }
              evidence={evidence(
                "rentalCostPerKmSampleCount",
                costPerKm.reduce((n, c) => n + c.rentals, 0)
              )}
            />
          </div>
          <CountingHelp
            entries={[
              { term: t("rental:stats.kmPerDay"), helpKey: "rental:stats.help.kmPerDay" },
              { term: t("rental:stats.costPerKm"), helpKey: "rental:stats.help.costPerKm" },
            ]}
          />
        </div>
      )}

      {show("billing") && (
        <div data-testid="rental-billing">
          <h3 className="text-sm font-semibold">{t("rental:stats.bookedVsFinal")}</h3>
          {bookedVsFinal.byCurrency.length === 0 ? (
            <p className="t-caption mt-1">{t("rental:stats.bookedVsFinalNone")}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {bookedVsFinal.byCurrency.map((c) => (
                <li key={c.currency} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {t("rental:stats.bookedVsFinalRow", {
                      count: c.rentals,
                      booked: money(c.booked, c.currency),
                      final: money(c.final, c.currency),
                    })}
                  </span>
                  <span className="font-mono">
                    {c.difference > 0 ? "+" : ""}
                    {money(c.difference, c.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {bookedVsFinal.otherCurrency > 0 && (
            <p className="t-caption mt-1">
              {t("rental:stats.bookedVsFinalOtherCurrency", {
                count: bookedVsFinal.otherCurrency,
              })}
            </p>
          )}
          <CountingHelp
            entries={[
              { term: t("rental:stats.bookedVsFinal"), helpKey: "rental:stats.help.bookedVsFinal" },
            ]}
          />
        </div>
      )}

      {show("vehicles") && (
        <div data-testid="rental-vehicles">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rental:stats.vehiclesDriven")}
              value={vehicles.withDriven === 0 ? "–" : num(vehicles.distinctDriven)}
              description={t("rental:stats.vehiclesDrivenDesc", {
                covered: vehicles.withDriven,
                of: stats.rentals,
              })}
              evidence={evidence("rentalDrivenModelsCount", vehicles.distinctDriven)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rental:stats.promisedVsDriven")}
              value={
                vehicles.promisedVsDriven.compared === 0
                  ? "–"
                  : `${num(vehicles.promisedVsDriven.sameModel)} / ${num(
                      vehicles.promisedVsDriven.compared
                    )}`
              }
              description={
                vehicles.promisedVsDriven.compared === 0
                  ? t("rental:stats.promisedVsDrivenNone")
                  : t("rental:stats.promisedVsDrivenDesc", {
                      other: vehicles.promisedVsDriven.otherModel,
                    })
              }
              evidence={evidence("rentalVehicleComparedCount", vehicles.promisedVsDriven.compared)}
            />
            <RankedBarList
              title={t("rental:stats.classes")}
              rows={classRows}
              accent={accent}
              emptyLabel={t("rental:stats.noClasses")}
            />
          </div>
          <CountingHelp
            entries={[
              { term: t("rental:stats.vehiclesDriven"), helpKey: "rental:stats.help.vehicles" },
              {
                term: t("rental:stats.promisedVsDriven"),
                helpKey: "rental:stats.help.promisedVsDriven",
              },
            ]}
          />
        </div>
      )}

      {show("records") && (
        <div data-testid="rental-records">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* A record's figure opens its witness; the line under it stays a
                link to the rental, outside the trigger (no link in a button). */}
            <StatCard
              accent={accent}
              valueSize="sm"
              title={t("rental:stats.longest")}
              value={records.longest ? t("rental:list.days", { count: records.longest.days }) : "–"}
              evidence={evidence("rentalLongest", records.longest?.days ?? null)}
              descriptionHasOwnTrigger
              description={
                records.longest ? (
                  <Link to={`/rentals/${records.longest.id}`} className="hover:underline">
                    {records.longest.provider}
                  </Link>
                ) : (
                  ""
                )
              }
            />
            <StatCard
              accent={accent}
              valueSize="sm"
              title={t("rental:stats.farthest")}
              value={records.farthest ? `${num(records.farthest.km)} km` : "–"}
              evidence={evidence("rentalFarthest", records.farthest?.km ?? null)}
              descriptionHasOwnTrigger
              description={
                records.farthest ? (
                  <Link to={`/rentals/${records.farthest.id}`} className="hover:underline">
                    {t(`rental:distance.${records.farthest.source ?? "unknown"}`)}
                  </Link>
                ) : (
                  t("rental:stats.farthestNone")
                )
              }
            />
            <StatCard
              accent={accent}
              valueSize="sm"
              title={t("rental:stats.newProviders")}
              value={num(records.newProviders.length)}
              description={records.newProviders.join(", ") || t("rental:stats.newProvidersNone")}
              evidence={evidence("rentalNewProvidersCount", records.newProviders.length)}
            />
          </div>
          <CountingHelp
            entries={[
              { term: t("rental:stats.recordsLabel"), helpKey: "rental:stats.help.records" },
            ]}
          />
        </div>
      )}
    </>
  );
}
