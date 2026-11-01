import { useId, useState } from "react";
import { Button, Chip, Dialog, Field, Input, Select } from "../../components/ui";
import { useTranslation } from "../../hooks/useTranslation";
import { currencyForCountry } from "../../shared/countryCurrency";
import { travplanApi, type PlanKind, type PlanPlace, type PlanView } from "../../lib/api/travplan";
import { newPlanId } from "../../lib/travplanId";
import { apiErrorMachineCode } from "../../lib/apiError";
import { PlanActions, PlanNotice } from "./planLayout";
import { PlacePicker } from "./route/PlacePicker";
import { newStage, newStation } from "./route/routeModel";
import { entryRecord } from "./planContext";

type Shape = "stay" | "route";
interface Held {
  kind: Extract<PlanKind, "ferry" | "rail" | "flight" | "hotel" | "rental">;
  title: string;
  estimate: string;
}
const HELD_KINDS: Held["kind"][] = ["ferry", "rail", "flight", "hotel", "rental"];
const PACES = ["relaxed", "balanced", "busy"] as const;

const label = (p: PlanPlace | null) =>
  p ? [p.name, p.country, p.zone].filter(Boolean).join(" · ") : "";

/**
 * The create flow (board 3): where and when first, then what is already settled or still to be
 * booked. A destination is PICKED, so time zone, currency and weather location arrive with it and
 * are shown, editable, instead of being typed into three blank fields afterwards.
 */
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
    [goal, setGoal] = useState<PlanPlace | null>(null),
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
  const main = shape === "route" ? goal : start;
  const take = (place: PlanPlace, set: (p: PlanPlace) => void, primary: boolean) => {
    set(place);
    if (!primary) return;
    setZone(place.zone ?? "");
    setCurrency(currencyForCountry(place.country) ?? "EUR");
    if (!name) setName(place.name);
  };
  const ready =
    !!main &&
    (shape === "stay" || !!start) &&
    !!startDay &&
    !!endDay &&
    endDay >= startDay &&
    !!name.trim();
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
          latitude: (shape === "route" && start ? start : main).lat,
          longitude: (shape === "route" && start ? start : main).lon,
          travelers,
          pace,
          currency: currency || "EUR",
        });
        setMade(plan);
      }
      const write = async (operation: Parameters<typeof travplanApi.write>[1]) => {
        plan = await travplanApi.write(plan!, operation);
      };
      if (shape === "route" && start) {
        const stops = [start, main, ...(back ? [start] : [])].map((p) => newStation(p, 0));
        await write({ type: "route_settings", shape: "route" });
        for (const s of stops)
          await write({ type: "upsert", collection: "stations", value: entryRecord(s) });
        for (let i = 1; i < stops.length; i++)
          await write({
            type: "upsert",
            collection: "stages",
            value: entryRecord(newStage(stops[i - 1].id, stops[i].id)),
          });
      }
      for (const h of held) {
        const amount = h.estimate.trim() === "" ? null : Number(h.estimate);
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
            estimate:
              amount !== null && Number.isFinite(amount)
                ? { amount, currency: currency || "EUR" }
                : null,
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
          {shape === "route" && (
            <Field label={t("create.start")} htmlFor={uid + "-start"} hint={label(start)}>
              <PlacePicker
                label={t("create.startSearch")}
                onPick={(p) => take(p, setStart, false)}
              />
            </Field>
          )}
          <Field
            label={t(shape === "route" ? "create.goal" : "create.destination")}
            htmlFor={uid + "-dest"}
            hint={label(shape === "route" ? goal : start)}
          >
            <PlacePicker
              label={t("create.destinationSearch")}
              onPick={(p) => (shape === "route" ? take(p, setGoal, true) : take(p, setStart, true))}
            />
          </Field>
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
            <Field label={t("fields.startDay")} htmlFor={uid + "-from"}>
              <Input
                id={uid + "-from"}
                type="date"
                value={startDay}
                onChange={(e) => setStartDay(e.target.value)}
              />
            </Field>
            <Field label={t("fields.endDay")} htmlFor={uid + "-to"}>
              <Input
                id={uid + "-to"}
                type="date"
                value={endDay}
                min={startDay || undefined}
                onChange={(e) => setEndDay(e.target.value)}
              />
            </Field>
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
                <Input id={uid + "-zone"} value={zone} onChange={(e) => setZone(e.target.value)} />
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
                {t("create.weather", { place: (shape === "route" && start ? start : main).name })}
              </p>
            </div>
          )}
          <Field label={t("create.name")} htmlFor={uid + "-name"}>
            <Input
              id={uid + "-name"}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
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
                  ×
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
