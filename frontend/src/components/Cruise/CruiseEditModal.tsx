import { minorUnits } from "../../shared/currencies";
import CurrencySelect from "../common/CurrencySelect";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
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
import { cruiseStatusPillStyle } from "./cruiseStatusStyle";
import CompanionPicker from "../CompanionPicker";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  cruise?: Cruise;
  onClose: () => void;
  onSaved: (saved: Cruise) => void | Promise<void>;
}

const CABIN_TYPES: CabinType[] = ["inside", "oceanview", "balcony", "suite"];

// Hex mirror of CRUISE_DISTINCT_PALETTE (lib/cruiseColor.ts) — the same
// distinct hues the map's auto-derive falls back to, so a manual pick still
// looks consistent with un-colored cruises. Keep both palettes in sync.
const COLOR_PALETTE = [
  "#e88374",
  "#f4bf4f",
  "#7ec87a",
  "#5fc2b2",
  "#82aaff",
  "#b284e0",
  "#e88ac4",
  "#d6a05c",
  "#78cdd6",
  "#b0c46c",
] as const;

// Cruise start/end are date-granular (a voyage spans whole days). Use a
// date-only round-trip pinned to UTC midnight. This fixes two bugs:
//   1. A `datetime-local` input stays EMPTY until BOTH date and time are set,
//      so a user who picked only a date sent "" → null → the date silently
//      vanished from the overview. A `type="date"` input yields a value from
//      the date alone.
//   2. `new Date(local).toISOString()` converted the picked wall-clock from the
//      browser timezone to UTC, while display sliced the UTC ISO straight back
//      into the picker — so a date drifted to the previous day (e.g. Berlin
//      00:00 → stored 22:00Z → shown as the day before). Pinning to a literal
//      UTC instant keeps the round-trip stable and timezone-neutral.
const toDateInput = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "");

const fromDateInput = (date: string): string | null => (date ? `${date}T00:00:00.000Z` : null);

const splitCsv = (v: string): string[] =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden";

// color-scheme: dark tells the browser to render native picker widgets
// (calendar icon, spinners) in dark mode colors. Without it, date /
// datetime-local inputs render the TT.MM.JJJJ placeholder mask in a
// nearly-black color that is unreadable on our dark surface.
const DARK_PICKER_STYLE: React.CSSProperties = { colorScheme: "dark" };

/**
 * Modal for creating or editing a cruise — a single manual entry form.
 * Email/PDF import is the first route in the add-dialog (DomainImportPanel),
 * so this modal no longer carries its own import chooser.
 */
export function CruiseEditModal({ mode, cruise, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation("cruise");

  const [ship, setShip] = useState<Ship | null>(cruise?.ship ?? null);
  const [cruiseLine, setCruiseLine] = useState<string>(cruise?.cruiseLine ?? "");
  const [routeName, setRouteName] = useState<string>(cruise?.routeName ?? "");
  const [startDate, setStartDate] = useState<string>(toDateInput(cruise?.startDate));
  const [endDate, setEndDate] = useState<string>(toDateInput(cruise?.endDate));
  const [status, setStatus] = useState<CruiseStatus>(cruise?.status ?? "scheduled");
  const [color, setColor] = useState<string | null>(cruise?.color ?? null);

  const [departurePort, setDeparturePort] = useState<Port | null>(cruise?.departurePort ?? null);
  const [arrivalPort, setArrivalPort] = useState<Port | null>(cruise?.arrivalPort ?? null);
  const [stops, setStops] = useState<CruiseStopInput[]>(
    (cruise?.stops ?? []).map((s) => ({
      portId: s.portId,
      port: s.port,
      dayNumber: s.dayNumber,
      date: s.date,
      isAtSea: s.isAtSea,
      arrivalTime: s.arrivalTime,
      departureTime: s.departureTime,
      excursionNote: s.excursionNote ?? undefined,
      unresolvedPortName: s.unresolvedPortName,
    }))
  );

  const [cabinNumber, setCabinNumber] = useState<string>(cruise?.cabinNumber ?? "");
  const [cabinType, setCabinType] = useState<CabinType | "">(cruise?.cabinType ?? "");
  const [deck, setDeck] = useState<string>(cruise?.deck?.toString() ?? "");

  const [bookingReference, setBookingReference] = useState<string>(cruise?.bookingReference ?? "");
  const [price, setPrice] = useState<string>(cruise?.price?.toString() ?? "");
  const [currency, setCurrency] = useState<string>(cruise?.currency ?? "EUR");
  const recentCurrencies = useRecentCurrencies();

  const [tagsInput, setTagsInput] = useState<string>((cruise?.tags ?? []).join(", "));
  const [companions, setCompanions] = useState<string[]>(cruise?.companions ?? []);
  const [notes, setNotes] = useState<string>(cruise?.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        // null = explicit clear; undefined would tell the server "keep the
        // old value" and make blanking any of these a silent no-op in edit
        // mode (same defect family the flight edit modal had).
        cruiseLine: cruiseLine || null,
        routeName: routeName || null,
        departurePortId: departurePort?.id ?? null,
        arrivalPortId: arrivalPort?.id ?? null,
        startDate: fromDateInput(startDate),
        endDate: fromDateInput(endDate),
        status,
        color,
        cabinNumber: cabinNumber || null,
        cabinType: (cabinType || null) as CabinType | null,
        deck: deck ? Number.parseInt(deck, 10) : null,
        bookingReference: bookingReference || null,
        price: price ? Number.parseFloat(price) : null,
        currency: (currency || "EUR") as CruiseInput["currency"],
        tags: splitCsv(tagsInput),
        companions,
        notes: notes || null,
        // Strip the UI-only `port` object from each stop before sending —
        // the backend only wants portId/isAtSea/times/note. Always sent,
        // including as []: omitting the field when the user removed every
        // stop would silently keep the old stops (the server reads absence
        // as "don't touch").
        stops: stops.map(({ port: _port, ...rest }) => rest),
      };
      const saved =
        mode === "create"
          ? await cruiseApi.create(input)
          : await cruiseApi.update((cruise as Cruise).id, input);
      await onSaved(saved);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        t("form.saveError");
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = mode === "create" ? t("form.createTitle") : t("form.editTitle");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-(--bg-base) shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-(--bg-base) px-6 py-4">
          <h2 className="text-xl font-semibold text-(--text-primary)">{headerTitle}</h2>
        </div>

        <>
          <div className="p-6">
            <Section title={`${t("field.ship")} & ${t("field.line")}`}>
              <ShipPicker value={ship} onChange={onShipPicked} />
              <input
                className={`mt-3 ${INPUT_CLASS}`}
                aria-label={t("field.line")}
                value={cruiseLine}
                onChange={(e): void => setCruiseLine(e.target.value)}
                placeholder={t("field.line")}
              />
              <input
                className={`mt-3 ${INPUT_CLASS}`}
                aria-label={t("field.routeName")}
                value={routeName}
                onChange={(e): void => setRouteName(e.target.value)}
                placeholder={t("field.routeName")}
              />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <input
                  type="date"
                  aria-label={t("field.depart")}
                  className={INPUT_CLASS}
                  style={DARK_PICKER_STYLE}
                  value={startDate}
                  onChange={(e): void => setStartDate(e.target.value)}
                />
                <input
                  type="date"
                  aria-label={t("field.arrive")}
                  className={INPUT_CLASS}
                  style={DARK_PICKER_STYLE}
                  value={endDate}
                  onChange={(e): void => setEndDate(e.target.value)}
                />
              </div>
              {/* #status-from-dates: cruise write paths derive scheduled/
                  in_progress/flown from the dates — a select just let the UI
                  set a value the backend would immediately overwrite. Only
                  "cancelled" stays user-controlled, via the checkbox below. */}
              <div className="mt-3">
                <span
                  className="inline-block rounded-full px-2 py-1 text-xs font-semibold"
                  style={cruiseStatusPillStyle(status)}
                >
                  {t(`status.${status}`, { defaultValue: status })}
                </span>
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={status === "cancelled"}
                  onChange={(e): void => setStatus(e.target.checked ? "cancelled" : "scheduled")}
                />
                {t("status.cancelledCheckbox")}
              </label>
            </Section>

            <Section title={t("detail.mapColor")}>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={(): void => setColor(null)}
                  aria-label={t("field.colorAuto")}
                  title={t("field.colorAuto")}
                  aria-pressed={color === null}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed text-xs transition-transform hover:scale-110"
                  style={{
                    borderColor: color === null ? "var(--accent)" : "var(--color-border)",
                    color: "var(--text-muted)",
                  }}
                >
                  ×
                </button>
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={(): void => setColor(c)}
                    aria-label={c}
                    aria-pressed={color === c}
                    className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: c,
                      outline: color === c ? `2px solid ${c}` : "none",
                      outlineOffset: "2px",
                    }}
                  />
                ))}
                <input
                  type="color"
                  aria-label={t("field.color")}
                  value={color ?? "#000000"}
                  onChange={(e): void => setColor(e.target.value)}
                  className="h-7 w-9 cursor-pointer rounded-sm border border-border bg-transparent p-0"
                />
              </div>
            </Section>

            <Section title={t("stops.title")}>
              <div className="grid grid-cols-2 gap-3">
                <PortPicker
                  value={departurePort}
                  onChange={setDeparturePort}
                  label={t("field.departure_port")}
                />
                <PortPicker
                  value={arrivalPort}
                  onChange={setArrivalPort}
                  label={t("field.arrival_port")}
                />
              </div>
              <div className="mt-3">
                <CruiseStopsEditor stops={stops} onChange={setStops} />
              </div>
            </Section>

            <Section title={t("detail.cabin")}>
              <div className="grid grid-cols-3 gap-3">
                <input
                  aria-label={t("field.cabin")}
                  className={INPUT_CLASS}
                  value={cabinNumber}
                  onChange={(e): void => setCabinNumber(e.target.value)}
                  placeholder={t("field.cabin")}
                />
                <select
                  aria-label={t("field.cabinType")}
                  className={INPUT_CLASS}
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
                  className={INPUT_CLASS}
                  value={deck}
                  onChange={(e): void => setDeck(e.target.value)}
                  placeholder={t("field.deck")}
                />
              </div>
            </Section>

            <Section title={t("detail.costs")}>
              <div className="grid grid-cols-3 gap-3">
                <input
                  aria-label={t("field.bookingReference")}
                  className={INPUT_CLASS}
                  value={bookingReference}
                  onChange={(e): void => setBookingReference(e.target.value)}
                  placeholder={t("field.bookingReference")}
                />
                <input
                  type="number"
                  min={0}
                  step={10 ** -minorUnits(currency)}
                  aria-label={t("field.price")}
                  className={INPUT_CLASS}
                  value={price}
                  onChange={(e): void => setPrice(e.target.value)}
                  placeholder={t("field.price")}
                />
                <CurrencySelect
                  aria-label={t("field.currency")}
                  value={currency}
                  recent={recentCurrencies}
                  onChange={setCurrency}
                />
              </div>
            </Section>

            <Section title={t("detail.meta")}>
              <input
                aria-label={t("field.tags")}
                className={INPUT_CLASS}
                value={tagsInput}
                onChange={(e): void => setTagsInput(e.target.value)}
                placeholder={t("field.tags")}
              />
              <div className="mt-3">
                <label className="label">{t("field.companions")}</label>
                <CompanionPicker value={companions} onChange={setCompanions} />
              </div>
              <textarea
                aria-label={t("field.notes")}
                rows={3}
                className={`mt-3 ${INPUT_CLASS}`}
                value={notes}
                onChange={(e): void => setNotes(e.target.value)}
                placeholder={t("field.notes")}
              />
            </Section>

            {error !== null && (
              <div className="mb-3 rounded-md border border-(--danger)/50 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)">
                {error}
              </div>
            )}
          </div>

          {/* Footer with action buttons — only on manual step */}
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-(--bg-base) px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
            >
              {t("form.cancel")}
            </button>
            <button
              type="button"
              onClick={(): void => {
                void submit();
              }}
              disabled={saving}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
            >
              {saving ? t("form.saving") : t("form.save")}
            </button>
          </div>
        </>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <details
      open
      className="mb-4 rounded-md border border-border bg-(--bg-surface)/50 p-3"
    >
      <summary className="cursor-pointer text-sm font-medium text-(--text-primary)">
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
