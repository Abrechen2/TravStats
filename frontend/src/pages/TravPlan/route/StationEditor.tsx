import { useId, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Input, Select, TextArea } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import { newPlanId } from "../../../lib/travplanId";
import type { PlanBooking, PlanNight, PlanPlace, PlanStation } from "../../../lib/api/travplan";
import { PlanActions, PlanRow, PlanGrow } from "../planLayout";
import { PlacePicker } from "./PlacePicker";

const NIGHT_KINDS: PlanNight["kind"][] = ["spontaneous", "pitch", "idea", "booked", "onboard"];
const MAX_NIGHTS = 60;

/** Edit one station: its place (picked, never typed), nights, pinned day and what happens at night. */
export function StationEditor({
  station,
  bookings,
  allowOnboard,
  busy,
  onSave,
  onClose,
}: {
  station: PlanStation;
  bookings: PlanBooking[];
  /** Only an overnight ferry arriving here makes "an Bord" a valid night. */
  allowOnboard: boolean;
  busy: boolean;
  onSave: (station: PlanStation) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation("travplan"),
    uid = useId(),
    [value, setValue] = useState(station),
    [candidate, setCandidate] = useState("");
  const lodging = bookings.filter((b) => b.kind === "hotel");
  const night = value.night;
  const kinds = NIGHT_KINDS.filter(
    (k) => k !== "onboard" || allowOnboard || night.kind === "onboard"
  );
  const setNight = (kind: PlanNight["kind"]) =>
    setValue({
      ...value,
      night:
        kind === "booked"
          ? { kind, bookingId: lodging[0]?.id ?? "" }
          : kind === "idea"
            ? { kind, candidates: [] }
            : ({ kind } as PlanNight),
    });
  const setPlace = (place: PlanPlace) =>
    setValue({
      ...value,
      place,
      title: value.title && value.title !== value.place.name ? value.title : place.name,
    });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (night.kind === "booked" && !night.bookingId) return;
    if (await onSave(value)) onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={t("route.station.edit")}
      dirty={JSON.stringify(value) !== JSON.stringify(station)}
    >
      <form
        id={uid}
        onSubmit={(e) => void submit(e)}
        className="flex flex-col"
        style={{ gap: "var(--ts-space-lg)" }}
      >
        <Field
          label={t("route.station.place")}
          htmlFor={uid + "-place"}
          hint={[value.place.name, value.place.country, value.place.zone]
            .filter(Boolean)
            .join(" · ")}
        >
          <PlacePicker label={t("route.station.changePlace")} onPick={setPlace} />
        </Field>
        <Field label={t("route.station.title")} htmlFor={uid + "-title"}>
          <Input
            id={uid + "-title"}
            value={value.title}
            maxLength={200}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
          />
        </Field>
        <Field label={t("route.station.nights")} htmlFor={uid + "-nights"}>
          <Input
            id={uid + "-nights"}
            type="number"
            min={0}
            max={MAX_NIGHTS}
            value={value.nights}
            onChange={(e) =>
              setValue({
                ...value,
                nights: Math.min(MAX_NIGHTS, Math.max(0, Math.trunc(Number(e.target.value) || 0))),
              })
            }
          />
        </Field>
        <Field
          label={t("route.station.pinned")}
          htmlFor={uid + "-pin"}
          hint={t("route.station.pinnedHint")}
        >
          <Input
            id={uid + "-pin"}
            type="date"
            value={value.pinnedDay ?? ""}
            onChange={(e) => setValue({ ...value, pinnedDay: e.target.value || null })}
          />
        </Field>
        <Field label={t("route.station.night")} htmlFor={uid + "-night"}>
          <Select
            id={uid + "-night"}
            value={night.kind}
            onChange={(e) => setNight(e.target.value as PlanNight["kind"])}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t("route.night." + k)}
              </option>
            ))}
          </Select>
        </Field>
        {night.kind === "booked" &&
          (lodging.length ? (
            <Field label={t("route.station.booking")} htmlFor={uid + "-booking"}>
              <Select
                id={uid + "-booking"}
                value={night.bookingId}
                onChange={(e) =>
                  setValue({ ...value, night: { kind: "booked", bookingId: e.target.value } })
                }
              >
                {lodging.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                    {b.placeholder ? " · " + t("route.tone.placeholder") : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="t-caption">{t("route.station.noLodging")}</p>
          ))}
        {night.kind === "idea" && (
          <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
            {night.candidates.map((c) => (
              <PlanRow key={c.id}>
                <PlanGrow>{c.title}</PlanGrow>
                <Button
                  onClick={() =>
                    setValue({
                      ...value,
                      night: {
                        kind: "idea",
                        candidates: night.candidates.filter((x) => x.id !== c.id),
                      },
                    })
                  }
                >
                  {t("delete")}
                </Button>
              </PlanRow>
            ))}
            <PlanActions>
              <Input
                aria-label={t("route.station.candidate")}
                placeholder={t("route.station.candidate")}
                value={candidate}
                maxLength={200}
                onChange={(e) => setCandidate(e.target.value)}
              />
              <Button
                disabled={!candidate.trim() || night.candidates.length >= 10}
                onClick={() => {
                  setValue({
                    ...value,
                    night: {
                      kind: "idea",
                      candidates: [
                        ...night.candidates,
                        {
                          id: newPlanId(),
                          title: candidate.trim(),
                          place: null,
                          url: null,
                          note: "",
                        },
                      ],
                    },
                  });
                  setCandidate("");
                }}
              >
                {t("add")}
              </Button>
            </PlanActions>
          </div>
        )}
        <Field label={t("fields.note")} htmlFor={uid + "-note"}>
          <TextArea
            id={uid + "-note"}
            value={value.note}
            maxLength={1000}
            onChange={(e) => setValue({ ...value, note: e.target.value })}
          />
        </Field>
        <PlanActions>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("saving") : t("save")}
          </Button>
          <Button onClick={onClose}>{t("cancel")}</Button>
        </PlanActions>
      </form>
    </Dialog>
  );
}
