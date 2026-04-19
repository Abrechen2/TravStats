import { useState } from "react";
import type {
  Cruise,
  CruiseInput,
  CruiseStopInput,
  Ship,
  Port,
  CabinType,
  CruiseStatus,
} from "../../types";
import { cruiseApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { ShipPicker } from "./ShipPicker";
import { PortPicker } from "./PortPicker";
import { CruiseStopsEditor } from "./CruiseStopsEditor";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  cruise?: Cruise;
  onClose: () => void;
  onSaved: (saved: Cruise) => void | Promise<void>;
}

const STATUSES: CruiseStatus[] = ["scheduled", "flown", "cancelled", "historical"];
const CABIN_TYPES: CabinType[] = ["inside", "oceanview", "balcony", "suite"];
const CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

/**
 * Convert an ISO string (or null) to the value expected by
 * a `<input type="datetime-local">` control (YYYY-MM-DDTHH:mm).
 */
const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return "";
  return iso.slice(0, 16);
};

/**
 * Convert a `datetime-local` string back to an ISO UTC string.
 * Returns null for empty input so it can be omitted from the payload.
 */
const fromLocalInput = (local: string): string | null => {
  if (!local) return null;
  return new Date(local).toISOString();
};

const splitCsv = (v: string): string[] =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

/**
 * Modal form for creating or editing a cruise.
 *
 * Composes the ShipPicker / PortPicker / CruiseStopsEditor leaf components
 * into five collapsible sections: ship & basics, ports & stops, cabin,
 * costs, and meta. On submit it dispatches to cruiseApi.create or
 * cruiseApi.update depending on `mode` and surfaces server-side validation
 * errors in a red banner without closing the modal.
 */
export function CruiseEditModal({ mode, cruise, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation("cruise");

  const [ship, setShip] = useState<Ship | null>(cruise?.ship ?? null);
  const [cruiseLine, setCruiseLine] = useState<string>(cruise?.cruiseLine ?? "");
  const [startDate, setStartDate] = useState<string>(toLocalInput(cruise?.startDate));
  const [endDate, setEndDate] = useState<string>(toLocalInput(cruise?.endDate));
  const [status, setStatus] = useState<CruiseStatus>(cruise?.status ?? "scheduled");

  const [departurePort, setDeparturePort] = useState<Port | null>(cruise?.departurePort ?? null);
  const [arrivalPort, setArrivalPort] = useState<Port | null>(cruise?.arrivalPort ?? null);
  const [stops, setStops] = useState<CruiseStopInput[]>(
    (cruise?.stops ?? []).map((s) => ({
      portId: s.portId,
      dayNumber: s.dayNumber,
      isAtSea: s.isAtSea,
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
      excursionNote: s.excursionNote ?? undefined,
    }))
  );

  const [cabinNumber, setCabinNumber] = useState<string>(cruise?.cabinNumber ?? "");
  const [cabinType, setCabinType] = useState<CabinType | "">(cruise?.cabinType ?? "");
  const [deck, setDeck] = useState<string>(cruise?.deck?.toString() ?? "");

  const [bookingReference, setBookingReference] = useState<string>(cruise?.bookingReference ?? "");
  const [price, setPrice] = useState<string>(cruise?.price?.toString() ?? "");
  const [currency, setCurrency] = useState<string>(cruise?.currency ?? "EUR");

  const [tagsInput, setTagsInput] = useState<string>((cruise?.tags ?? []).join(", "));
  const [companionsInput, setCompanionsInput] = useState<string>(
    (cruise?.companions ?? []).join(", ")
  );
  const [notes, setNotes] = useState<string>(cruise?.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When a ship is picked, prefill the cruise-line field if the user hasn't
  // already typed one. Picking a ship should never overwrite a manual edit.
  const onShipPicked = (s: Ship): void => {
    setShip(s);
    if (!cruiseLine) setCruiseLine(s.cruiseLine);
  };

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const input: CruiseInput = {
        shipId: ship?.id ?? null,
        cruiseLine: cruiseLine || undefined,
        departurePortId: departurePort?.id ?? null,
        arrivalPortId: arrivalPort?.id ?? null,
        startDate: fromLocalInput(startDate),
        endDate: fromLocalInput(endDate),
        status,
        cabinNumber: cabinNumber || undefined,
        cabinType: (cabinType || undefined) as CabinType | undefined,
        deck: deck ? Number.parseInt(deck, 10) : undefined,
        bookingReference: bookingReference || undefined,
        price: price ? Number.parseFloat(price) : undefined,
        currency: (currency || "EUR") as CruiseInput["currency"],
        tags: splitCsv(tagsInput),
        companions: splitCsv(companionsInput),
        notes: notes || undefined,
        stops: stops.length > 0 ? stops : undefined,
      };
      const saved =
        mode === "create"
          ? await cruiseApi.create(input)
          : // In edit mode a cruise prop is required by contract; the caller
            // guarantees it.
            await cruiseApi.update((cruise as Cruise).id, input);
      await onSaved(saved);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Unable to save cruise";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-neutral-700 bg-neutral-950 p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-neutral-100">
          {mode === "create" ? t("list.new") : t("detail.route")}
        </h2>

        <Section title={`${t("field.ship")} & ${t("field.line")}`}>
          <ShipPicker value={ship} onChange={onShipPicked} />
          <input
            className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            aria-label={t("field.line")}
            value={cruiseLine}
            onChange={(e): void => setCruiseLine(e.target.value)}
            placeholder={t("field.line")}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              type="datetime-local"
              aria-label={t("field.depart")}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
              value={startDate}
              onChange={(e): void => setStartDate(e.target.value)}
            />
            <input
              type="datetime-local"
              aria-label={t("field.arrive")}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
              value={endDate}
              onChange={(e): void => setEndDate(e.target.value)}
            />
          </div>
          <select
            aria-label="status"
            className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            value={status}
            onChange={(e): void => setStatus(e.target.value as CruiseStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </Section>

        <Section title={t("stops.title")}>
          <div className="grid grid-cols-2 gap-2">
            <PortPicker value={departurePort} onChange={setDeparturePort} />
            <PortPicker value={arrivalPort} onChange={setArrivalPort} />
          </div>
          <div className="mt-3">
            <CruiseStopsEditor stops={stops} onChange={setStops} />
          </div>
        </Section>

        <Section title={t("detail.cabin")}>
          <div className="grid grid-cols-3 gap-2">
            <input
              aria-label={t("field.cabin")}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              value={cabinNumber}
              onChange={(e): void => setCabinNumber(e.target.value)}
              placeholder={t("field.cabin")}
            />
            <select
              aria-label={t("field.cabinType")}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              value={cabinType}
              onChange={(e): void => setCabinType(e.target.value as CabinType | "")}
            >
              <option value="">—</option>
              {CABIN_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`cabinType.${c}`)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={30}
              aria-label={t("field.deck")}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              value={deck}
              onChange={(e): void => setDeck(e.target.value)}
              placeholder={t("field.deck")}
            />
          </div>
        </Section>

        <Section title={t("detail.costs")}>
          <div className="grid grid-cols-3 gap-2">
            <input
              aria-label={t("field.bookingReference")}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              value={bookingReference}
              onChange={(e): void => setBookingReference(e.target.value)}
              placeholder={t("field.bookingReference")}
            />
            <input
              type="number"
              min={0}
              step={0.01}
              aria-label={t("field.price")}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              value={price}
              onChange={(e): void => setPrice(e.target.value)}
              placeholder={t("field.price")}
            />
            <select
              aria-label="currency"
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              value={currency}
              onChange={(e): void => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section title={t("detail.meta")}>
          <input
            aria-label={t("field.tags")}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            value={tagsInput}
            onChange={(e): void => setTagsInput(e.target.value)}
            placeholder={t("field.tags")}
          />
          <input
            aria-label={t("field.companions")}
            className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            value={companionsInput}
            onChange={(e): void => setCompanionsInput(e.target.value)}
            placeholder={t("field.companions")}
          />
          <textarea
            aria-label={t("field.notes")}
            rows={3}
            className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            value={notes}
            onChange={(e): void => setNotes(e.target.value)}
            placeholder={t("field.notes")}
          />
        </Section>

        {error !== null && (
          <div className="mb-3 rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(): void => {
              void submit();
            }}
            disabled={saving}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <details open className="mb-4 rounded-md border border-neutral-800 bg-neutral-900/50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-neutral-200">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
