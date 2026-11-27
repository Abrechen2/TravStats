import DateRangeField from "../../components/ui/DateRangeField";
import { Icon } from "../../components/ui/Icon";
import { useId, useState } from "react";
import { Button, Chip, Dialog, Field, Input, Select } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { currencyForCountry } from "../../shared/countryCurrency";
import { daysBetween, supportedZones } from "../../shared/time";
import {
  travplanApi,
  type PlanKind,
  type PlanPlace,
  type PlanVehicle,
  type PlanView,
} from "../../lib/api/travplan";
import { newPlanId } from "../../lib/travplanId";
import { apiErrorMachineCode } from "../../lib/apiError";
import { PlanActions, PlanNotice } from "./planLayout";
import { PlacePicker } from "./route/PlacePicker";
import { entryRecord } from "./planContext";
import { RouteLegs } from "./create/RouteLegs";
import {
  buildRoute,
  draftLegs,
  goalNights,
  legTitle,
  MAX_STATION_NIGHTS,
  nightsProblem,
  needsBooking,
  type DraftStop,
} from "./create/routeDraft";

type Shape = "stay" | "route";
interface Held {
  kind: Extract<PlanKind, "ferry" | "rail" | "flight" | "hotel" | "rental">;
  title: string;
  estimate: string;
}
const HELD_KINDS: Held["kind"][] = ["ferry", "rail", "flight", "hotel", "rental"];
const PACES = ["relaxed", "balanced", "busy"] as const;
const VEHICLES: PlanVehicle["kind"][] = [
  "motorhome",
  "campervan",
  "caravan",
  "car",
  "motorcycle",
  "bicycle",
  "other",
];
/** Stages whose figures the server works out right after creation. */
const MEASURED = new Set(["drive", "ferry"]);

const parseAmount = (raw: string) => {
  const n = raw.trim() === "" ? null : Number(raw);
  return n !== null && Number.isFinite(n) ? n : null;
};

const label = (p: PlanPlace | null) =>
  p ? [p.name, p.country, p.zone].filter(Boolean).join(" · ") : "";

/**
 * The create flow (board 3): where and when first, then what is already settled or still to be
 * booked. A destination is PICKED, so time zone, currency and weather location arrive with it and
 * are shown, editable, instead of being typed into three blank fields afterwards.
 */
/** ISO 4217 shape; the server refuses anything else and the dialog said only "did not work". */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** The runtime's zone list, plus the picked zone should an older runtime not list it. */
function zoneOptions(current: string): string[] {
  const all = supportedZones();
  return current && !all.includes(current) ? [current, ...all] : all;
}

export function PlanCreate({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (plan: PlanView) => void;
}) {
  const { t } = useTranslation("travplan"),
    uid = useId(),
    [step, setStep] = useState<1 | 2>(1),
    [shape, setShape] = useState<Shape>("stay"),
    [name, setName] = useState(""),
    [start, setStart] = useState<PlanPlace | null>(null),
    [stops, setStops] = useState<DraftStop[]>([]),
    [vehicle, setVehicle] = useState<PlanVehicle["kind"] | "">(""),
    [legEstimates, setLegEstimates] = useState<Record<number, string>>({}),
    [nameTouched, setNameTouched] = useState(false),
    [back, setBack] = useState(false),
    [startDay, setStartDay] = useState(""),
    [endDay, setEndDay] = useState(""),
    [travelers, setTravelers] = useState(1),
    [pace, setPace] = useState<(typeof PACES)[number]>("balanced"),
    [zone, setZone] = useState(""),
    [currency, setCurrency] = useState(""),
    [held, setHeld] = useState<Held[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [made, setMade] = useState<PlanView | null>(null);
  const goal = stops[stops.length - 1]?.place ?? null;
  const main = shape === "route" ? goal : start;
  const draft = shape === "route" && start && stops.length ? { start, stops, back } : null;
  const legs = draft ? draftLegs(draft) : [];
  /** The goal decides zone, currency and the name, until the traveller types a name. */
  const primary = (place: PlanPlace) => {
    setZone(place.zone ?? "");
    setCurrency(currencyForCountry(place.country) ?? "EUR");
    if (!nameTouched) setName(place.name);
  };
  const changeStops = (next: DraftStop[]) => {
    setStops(next);
    setLegEstimates({});
    const last = next[next.length - 1]?.place;
    if (last && last !== goal) primary(last);
  };
  const nightsIssue =
    draft && startDay && endDay ? nightsProblem(draft, daysBetween(startDay, endDay)) : null;
  const ready =
    !nightsIssue &&
    !!main &&
    (shape === "stay" || !!draft) &&
    !!startDay &&
    !!endDay &&
    endDay >= startDay &&
    !!name.trim() &&
    (currency === "" || CURRENCY_CODE.test(currency));
  const message = (cause: unknown) => {
    const code = apiErrorMachineCode(cause);
    return t("errors." + (code ?? "unknown"), { defaultValue: t("errors.unknown") });
  };
  async function create() {
    if (!main) return;
    setBusy(true);
    setError("");
    let plan = made;
    try {
      if (!plan) {
        plan = await travplanApi.create(name.trim(), {
          destination: shape === "route" && start ? `${start.name} → ${main.name}` : main.name,
          startDay,
          endDay,
          timezone: (zone || null) as string | null,
          latitude: (draft ? draft.start : main).lat,
          longitude: (draft ? draft.start : main).lon,
          travelers,
          pace,
          currency: currency || "EUR",
        });
        setMade(plan);
      }
      const write = async (operation: Parameters<typeof travplanApi.write>[1]) => {
        plan = await travplanApi.write(plan!, operation);
      };
      if (draft) {
        const estimates = Object.fromEntries(
          Object.entries(legEstimates).map(([k, v]) => [k, parseAmount(v)])
        );
        const built = buildRoute(draft, {
          nights: daysBetween(startDay, endDay),
          currency: currency || "EUR",
          estimates,
        });
        await write({
          type: "route_settings",
          shape: "route",
          vehicle: vehicle
            ? {
                kind: vehicle,
                lengthM: null,
                consumptionPer100: null,
                fuelPrice: null,
                fuelCurrency: null,
              }
            : null,
        });
        // Bookings before stages: a stage may only name a booking that exists.
        for (const s of built.stations)
          await write({ type: "upsert", collection: "stations", value: entryRecord(s) });
        for (const b of built.bookings)
          await write({ type: "upsert", collection: "bookings", value: entryRecord(b) });
        for (const g of built.stages)
          await write({ type: "upsert", collection: "stages", value: entryRecord(g) });
        // Distances and drive times straight away, so the plan does not open on "how long?".
        // A router that cannot answer records its reason on the stage; only a failed request throws.
        for (const g of built.stages)
          if (MEASURED.has(g.mode)) plan = await travplanApi.routeStage(plan!, g.id);
      }
      for (const h of held) {
        const amount = parseAmount(h.estimate);
        await write({
          type: "upsert",
          collection: "bookings",
          value: {
            id: newPlanId(),
            kind: h.kind,
            title: h.title.trim() || t("options." + h.kind),
            reference: null,
            provider: "",
            day: null,
            endDay: null,
            time: null,
            timezone: zone || null,
            amount: null,
            paid: 0,
            currency: currency || "EUR",
            place: "",
            documentIds: [],
            source: "manual",
            details: {},
            placeholder: true,
            estimate: amount !== null ? { amount, currency: currency || "EUR" } : null,
            stageId: null,
          },
        });
      }
      onCreated(plan!);
    } catch (cause) {
      // The plan exists once `made` is set: a later step failing must not create a second one.
      setError(message(cause));
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} busy={busy} title={t("create.title." + step)} maxWidth={740}>
      {step === 1 ? (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          <div
            className="flex"
            style={{ gap: "var(--ts-space-sm)" }}
            role="group"
            aria-label={t("create.shape")}
          >
            <Chip active={shape === "stay"} onClick={() => setShape("stay")}>
              {t("create.shapeStay")}
            </Chip>
            <Chip active={shape === "route"} onClick={() => setShape("route")}>
              {t("create.shapeRoute")}
            </Chip>
          </div>
          {shape === "route" ? (
            <RouteLegs
              uid={uid}
              start={start}
              stops={stops}
              onStart={setStart}
              onAdd={(p) => changeStops([...stops, { place: p, mode: "drive" }])}
              onStops={changeStops}
              goalNights={
                draft && startDay && endDay
                  ? goalNights(draft, daysBetween(startDay, endDay))
                  : null
              }
            />
          ) : (
            <Field label={t("create.destination")} htmlFor={uid + "-dest"} hint={label(start)}>
              <PlacePicker
                label={t("create.destinationSearch")}
                onPick={(p) => {
                  setStart(p);
                  primary(p);
                }}
              />
            </Field>
          )}
          {shape === "route" && (
            <Field label={t("create.vehicle")} htmlFor={uid + "-vehicle"}>
              <Select
                id={uid + "-vehicle"}
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value as typeof vehicle)}
              >
                <option value="">{t("create.vehicleNone")}</option>
                {VEHICLES.map((v) => (
                  <option key={v} value={v}>
                    {t("vehicle." + v)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {shape === "route" && (
            <label className="t-body flex items-center" style={{ gap: "var(--ts-space-md)" }}>
              <input
                type="checkbox"
                checked={back}
                onChange={(e) => setBack(e.target.checked)}
                style={{ accentColor: "var(--ts-accent)" }}
              />
              {t("create.back")}
            </label>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "var(--ts-space-lg)" }}>
            <div className="sm:col-span-2">
              <DateRangeField
                fromLabel={t("fields.startDay")}
                toLabel={t("fields.endDay")}
                from={startDay}
                to={endDay}
                quickPicks={[]}
                onChange={(range) => {
                  setStartDay(range.from);
                  setEndDay(range.to);
                }}
              />
            </div>
            <Field label={t("fields.travelers")} htmlFor={uid + "-n"}>
              <Input
                id={uid + "-n"}
                type="number"
                min={1}
                max={30}
                value={travelers}
                onChange={(e) => setTravelers(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
              />
            </Field>
            <Field label={t("fields.pace")} htmlFor={uid + "-pace"}>
              <Select
                id={uid + "-pace"}
                value={pace}
                onChange={(e) => setPace(e.target.value as typeof pace)}
              >
                {PACES.map((p) => (
                  <option key={p} value={p}>
                    {t("options." + p)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {main && (
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "var(--ts-space-lg)" }}>
              <Field label={t("fields.timezone")} htmlFor={uid + "-zone"} hint={t("create.taken")}>
                <Select id={uid + "-zone"} value={zone} onChange={(e) => setZone(e.target.value)}>
                  <option value="">{t("create.zoneUnknown")}</option>
                  {zoneOptions(zone).map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("fields.currency")} htmlFor={uid + "-cur"}>
                <Input
                  id={uid + "-cur"}
                  value={currency}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </Field>
              <p className="t-caption sm:col-span-2">
                {t("create.weather", { place: (draft ? draft.start : main).name })}
              </p>
            </div>
          )}
          <Field label={t("create.name")} htmlFor={uid + "-name"}>
            <Input
              id={uid + "-name"}
              value={name}
              maxLength={120}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
            />
          </Field>
          {nightsIssue && (
            <PlanNotice tone="bad">
              {t("create.nights." + nightsIssue, { max: MAX_STATION_NIGHTS })}
            </PlanNotice>
          )}
          <PlanActions>
            <Button variant="primary" disabled={!ready} onClick={() => setStep(2)}>
              {t("create.next")}
            </Button>
            <Button onClick={onClose}>{t("cancel")}</Button>
          </PlanActions>
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          <p className="t-body">{t("create.bookingsIntro")}</p>
          {legs.map((leg, i) =>
            needsBooking(leg.mode) ? (
              <Field
                key={"leg" + i}
                label={`${t("route.mode." + leg.mode)}: ${legTitle(leg)}`}
                htmlFor={`${uid}-leg${i}`}
                hint={t("create.legPlaceholder")}
              >
                <Input
                  id={`${uid}-leg${i}`}
                  placeholder={t("create.estimate")}
                  type="number"
                  min={0}
                  value={legEstimates[i] ?? ""}
                  onChange={(e) => setLegEstimates({ ...legEstimates, [i]: e.target.value })}
                />
              </Field>
            ) : null
          )}
          {held.map((h, i) => (
            <div
              key={i}
              className="grid grid-cols-1 sm:grid-cols-3"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <Select
                aria-label={t("fields.kind")}
                value={h.kind}
                onChange={(e) =>
                  setHeld(
                    held.map((x, j) =>
                      j === i ? { ...x, kind: e.target.value as Held["kind"] } : x
                    )
                  )
                }
              >
                {HELD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t("options." + k)}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={t("fields.title")}
                placeholder={t("fields.title")}
                value={h.title}
                onChange={(e) =>
                  setHeld(held.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                }
              />
              <div className="flex" style={{ gap: "var(--ts-space-sm)" }}>
                <Input
                  aria-label={t("create.estimate")}
                  placeholder={t("create.estimate")}
                  type="number"
                  min={0}
                  value={h.estimate}
                  onChange={(e) =>
                    setHeld(held.map((x, j) => (j === i ? { ...x, estimate: e.target.value } : x)))
                  }
                />
                <Button
                  aria-label={t("delete")}
                  onClick={() => setHeld(held.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size={16} />
                </Button>
              </div>
            </div>
          ))}
          <PlanActions>
            <Button onClick={() => setHeld([...held, { kind: "ferry", title: "", estimate: "" }])}>
              {t("create.addPlaceholder")}
            </Button>
          </PlanActions>
          {error && (
            <PlanNotice tone="bad">
              {made ? t("create.partial", { reason: error }) : error}
            </PlanNotice>
          )}
          <PlanActions>
            {made ? (
              <Button variant="primary" onClick={() => onCreated(made)}>
                {t("create.openPlan")}
              </Button>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void create()}>
                {busy ? t("saving") : t("create.finish")}
              </Button>
            )}
            <Button disabled={busy || !!made} onClick={() => setStep(1)}>
              {t("create.back1")}
            </Button>
          </PlanActions>
        </div>
      )}
    </Dialog>
  );
}
