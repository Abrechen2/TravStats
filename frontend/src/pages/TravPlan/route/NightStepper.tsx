import { useState } from "react";
import { Button } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanOperation, PlanState, PlanStation } from "../../../lib/api/travplan";
import { entryRecord } from "../planContext";
import { planDay } from "../format";
import { PlanNotice } from "../planLayout";
import { fixedAfter } from "./nightStep";

/**
 * One night more or less at a station, where the nights are read. When a booked leg or a pinned
 * day follows, one more night asks first and names what would no longer fit.
 */
export function NightStepper({
  state,
  station,
  busy,
  onWrite,
}: {
  state: PlanState;
  station: PlanStation;
  busy: boolean;
  onWrite: (op: PlanOperation) => void;
}) {
  const { t } = useTranslation("travplan"),
    [asking, setAsking] = useState(false),
    fixed = fixedAfter(state, station.id);
  const write = (nights: number) => {
    setAsking(false);
    onWrite({
      type: "upsert",
      collection: "stations",
      value: entryRecord({ ...station, nights }),
    });
  };
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <div className="flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
        <Button
          disabled={busy || station.nights === 0}
          aria-label={t("route.nights.less", { place: station.title })}
          onClick={() => write(station.nights - 1)}
        >
          −
        </Button>
        <span className="t-body" style={{ minWidth: "5.5rem", textAlign: "center" }}>
          {t("route.station.nightsCount", { count: station.nights })}
        </span>
        <Button
          disabled={busy}
          aria-label={t("route.nights.more", { place: station.title })}
          onClick={() => (fixed.length ? setAsking(true) : write(station.nights + 1))}
        >
          +
        </Button>
      </div>
      {asking && (
        <PlanNotice>
          {t("route.nights.fixed", {
            place: station.title,
            fixed: fixed.map((f) => `${f.title} (${planDay(f.day)})`).join(", "),
          })}
          <div
            className="flex"
            style={{ gap: "var(--ts-space-sm)", marginTop: "var(--ts-space-sm)" }}
          >
            <Button disabled={busy} onClick={() => write(station.nights + 1)}>
              {t("route.nights.anyway")}
            </Button>
            <Button onClick={() => setAsking(false)}>{t("cancel")}</Button>
          </div>
        </PlanNotice>
      )}
    </div>
  );
}
