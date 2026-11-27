import { useState } from "react";
import { Button, Card, Field, Input } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanOperation, PlanVehicle, PlanView } from "../../../lib/api/travplan";
import { PlanCardHead, PlanStack } from "../planLayout";
import { insertStop } from "./insertStop";

type Mutate = (op: PlanOperation) => Promise<boolean>;

const MIN_HOURS = 0.5;
const MAX_HOURS = 24;
const MIN_KM = 20;
const MAX_KM = 3000;

/** Hours the field shows for a stored minute limit; empty for none. */
const hoursText = (minutes: number | null | undefined): string =>
  minutes ? String(Math.round((minutes / 60) * 10) / 10) : "";
const kmText = (km: number | null | undefined): string => (km ? String(km) : "");

/** Empty is "no limit"; anything else must be a number inside the server's bounds. */
function parseLimit(text: string, min: number, max: number): number | null | "invalid" {
  const value = text.trim().replace(",", ".");
  if (value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : "invalid";
}

/** The vehicle's daily driving limits; a long drive is split by the lower one. */
export function VehicleLimits({
  plan,
  busy,
  mutate,
}: {
  plan: PlanView;
  busy: boolean;
  mutate: Mutate;
}) {
  const { t } = useTranslation("travplan");
  const vehicle = plan.state.vehicle;
  const [hours, setHours] = useState(hoursText(vehicle?.maxDriveMinutesPerDay));
  const [km, setKm] = useState(kmText(vehicle?.maxDriveKmPerDay));
  const [invalid, setInvalid] = useState<{ hours?: boolean; km?: boolean }>({});

  async function save() {
    const h = parseLimit(hours, MIN_HOURS, MAX_HOURS);
    const k = parseLimit(km, MIN_KM, MAX_KM);
    setInvalid({ hours: h === "invalid", km: k === "invalid" });
    if (h === "invalid" || k === "invalid") return;
    const base: PlanVehicle = vehicle ?? {
      kind: "other",
      lengthM: null,
      consumptionPer100: null,
      fuelPrice: null,
      fuelCurrency: null,
    };
    await mutate({
      type: "route_settings",
      vehicle: {
        ...base,
        maxDriveMinutesPerDay: h === null ? null : Math.round(h * 60),
        maxDriveKmPerDay: k === null ? null : k,
      },
    });
  }

  return (
    <Card>
      <PlanCardHead title={t("route.limits.title")} />
      <PlanStack>
        <p className="t-caption">{t("route.limits.hint")}</p>
        <Field
          label={t("route.limits.hours")}
          htmlFor="drive-limit-hours"
          error={invalid.hours ? t("route.limits.invalid") : undefined}
        >
          <Input
            id="drive-limit-hours"
            inputMode="decimal"
            value={hours}
            invalid={invalid.hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </Field>
        <Field
          label={t("route.limits.km")}
          htmlFor="drive-limit-km"
          error={invalid.km ? t("route.limits.invalid") : undefined}
        >
          <Input
            id="drive-limit-km"
            inputMode="decimal"
            value={km}
            invalid={invalid.km}
            onChange={(e) => setKm(e.target.value)}
          />
        </Field>
        <div>
          <Button disabled={busy} onClick={() => void save()}>
            {t("route.limits.save")}
          </Button>
        </div>
      </PlanStack>
    </Card>
  );
}

/**
 * The server's overnight suggestions for drives over the limit. Confirming a stop
 * writes the station and rewires the drive through it (`insertStop`); dismissing
 * records a decision, so the suggestion stays away until the drive changes.
 */
export function DriveSplits({
  plan,
  busy,
  mutate,
}: {
  plan: PlanView;
  busy: boolean;
  mutate: Mutate;
}) {
  const { t } = useTranslation("travplan");
  const { state } = plan;
  const open = (plan.schedule?.splits ?? []).flatMap((split) => {
    const finding = plan.findings.find((f) => f.id === "driveSplit:" + split.stageId);
    const stage = state.stages.find((g) => g.id === split.stageId);
    const index = stage ? state.stations.findIndex((s) => s.id === stage.fromStationId) : -1;
    return finding && stage && index >= 0 ? [{ split, finding, stage, index }] : [];
  });
  if (open.length === 0) return null;
  return (
    <>
      {open.map(({ split, finding, stage, index }) => {
        const from = state.stations[index].title;
        const to = state.stations.find((s) => s.id === stage.toStationId)?.title ?? "";
        const [first] = split.stops;
        return (
          <Card key={split.stageId} data-testid="drive-split">
            <PlanCardHead title={t("route.split.title", { from, to, days: split.days })} />
            <PlanStack>
              <p className="t-caption">{t("route.split.approximate")}</p>
              {first && (
                <p className="t-body">
                  {t("route.split.stop", {
                    n: 1,
                    km: first.afterKm ?? "?",
                    lat: first.lat,
                    lon: first.lon,
                  })}
                </p>
              )}
              <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    const place = {
                      name: t("route.split.stopName", { from, to }),
                      lat: first.lat,
                      lon: first.lon,
                      country: null,
                      zone: null,
                      ref: null,
                    };
                    for (const op of insertStop(state, index, place))
                      if (!(await mutate(op))) return;
                  }}
                >
                  {t("route.split.confirm")}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void mutate({
                      type: "decision",
                      value: {
                        id: finding.id,
                        fingerprint: finding.fingerprint,
                        choice: "dismissed",
                        decidedAt: new Date().toISOString(),
                      },
                    })
                  }
                >
                  {t("route.split.dismiss")}
                </Button>
              </div>
            </PlanStack>
          </Card>
        );
      })}
    </>
  );
}
