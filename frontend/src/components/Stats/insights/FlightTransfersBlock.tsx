import type { JSX } from "react";
import { Link } from "react-router-dom";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import EvidenceCount from "./EvidenceCount";
import { InsightHeading } from "./InsightHelp";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { FlightInsights, MeasuredTransfer } from "../../../types/flightInsights";

/**
 * Transfer times as a yearly balance and a record (forgejo#256). Only waits
 * between flights the user linked into one booking are here; every gap that
 * yielded no wait is named under its reason in the coverage line, so a short
 * list reads as "this is what could be measured", never as "you rarely change".
 */
export default function FlightTransfersBlock({
  transfers,
  nameOf,
}: {
  transfers: FlightInsights["transfers"];
  nameOf: (code: string) => string;
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  const muted = { color: "var(--text-muted)" };
  const c = transfers.coverage;
  const total = transfers.years.reduce((sum, y) => sum + y.count, 0);

  const record = (label: string, tr: MeasuredTransfer): JSX.Element => (
    <div>
      <dt className="font-medium">{label}</dt>
      <dd style={muted}>
        {fmt.duration(tr.minutes)}
        {tr.airport && ` · ${nameOf(tr.airport)}`}
        {tr.airportChange &&
          ` · ${t("stats:insights.transfers.airportChange", {
            from: tr.airportChange.from,
            to: tr.airportChange.to,
          })}`}{" "}
        ({fmt.day(tr.day)}){" "}
        <Link to={`/flights/${tr.arrivingFlightId}`} className="underline">
          {tr.arrivingFlightNumber ?? t("stats:insights.transfers.arriving")}
        </Link>
        {" → "}
        <Link to={`/flights/${tr.departingFlightId}`} className="underline">
          {tr.departingFlightNumber ?? t("stats:insights.transfers.departing")}
        </Link>
      </dd>
    </div>
  );

  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
      <InsightHeading
        id="insights-transfers"
        title={t("stats:insights.transfers.title")}
        topic="transfers"
      />
      {total === 0 ? (
        <p className="text-sm" style={muted}>
          {t("stats:insights.transfers.empty")}
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm">
            <EvidenceCount
              evidenceKey="flightTransferCount"
              scope={{ period: "allTime" }}
              value={total}
              label={t("stats:insights.transfers.measured")}
            >
              {t("stats:insights.transfers.measuredCount", { transfers: fmt.num(total) })}
            </EvidenceCount>
          </p>
          <dl className="mb-4 space-y-2 text-sm">
            {transfers.shortest &&
              record(t("stats:insights.transfers.shortest"), transfers.shortest)}
            {transfers.longest && record(t("stats:insights.transfers.longest"), transfers.longest)}
          </dl>
          <table className="w-full text-sm" aria-labelledby="insights-transfers">
            <thead style={muted}>
              <tr>
                <th className="px-2 py-1 text-left font-medium">
                  {t("stats:insights.discovery.year")}
                </th>
                <th className="px-2 py-1 text-right font-medium">
                  {t("stats:insights.transfers.count")}
                </th>
                <th className="px-2 py-1 text-right font-medium">
                  {t("stats:insights.transfers.median")}
                </th>
                <th className="px-2 py-1 text-right font-medium">
                  {t("stats:insights.transfers.shortest")}
                </th>
                <th className="px-2 py-1 text-right font-medium">
                  {t("stats:insights.transfers.longest")}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...transfers.years].reverse().map((y) => (
                <tr
                  key={y.year}
                  className="border-t"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <th scope="row" className="px-2 py-1 text-left font-medium">
                    {y.year}
                  </th>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <EvidenceCount
                      evidenceKey="flightTransferCount"
                      scope={{ period: "year", year: y.year }}
                      value={y.count}
                      label={`${t("stats:insights.transfers.measured")} ${y.year}`}
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {fmt.duration(y.medianMinutes)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <Link to={`/flights/${y.shortest.arrivingFlightId}`} className="underline">
                      {fmt.duration(y.shortest.minutes)}
                    </Link>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <Link to={`/flights/${y.longest.arrivingFlightId}`} className="underline">
                      {fmt.duration(y.longest.minutes)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {c.gaps > 0 && (
        <p className="mt-3 text-xs" style={muted}>
          {t("stats:insights.transfers.coverage", {
            measured: fmt.num(c.measured),
            gaps: fmt.num(c.gaps),
            bookings: fmt.num(c.bookings),
          })}{" "}
          {t("stats:insights.transfers.coverageDetail", {
            unknownTime: fmt.num(c.unknownTime),
            unknownOrder: fmt.num(c.unknownOrder),
            notFlown: fmt.num(c.notFlown),
            conflict: fmt.num(c.conflict),
            separate: fmt.num(c.separate),
          })}
        </p>
      )}
    </div>
  );
}
