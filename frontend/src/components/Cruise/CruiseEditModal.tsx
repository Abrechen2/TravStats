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
type EntryTab = "email" | "manual";

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

// Shared input styling that matches the flight entry form (text-base, py-3)
const INPUT_CLASS =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-3 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none";

/**
 * Modal form for creating or editing a cruise.
 *
 * Offers two entry modes at the top: an email-parser tab (currently a
 * coming-soon placeholder because the cruise parser is a 501 stub on the
 * backend) and a manual tab with the full form. The manual tab composes
 * the ShipPicker / PortPicker / CruiseStopsEditor leaf components into
 * five collapsible sections: ship & basics, ports & stops, cabin, costs,
 * and meta. On submit it dispatches to cruiseApi.create or
 * cruiseApi.update depending on `mode` and surfaces server-side
 * validation errors in a red banner without closing the modal.
 */
export function CruiseEditModal({ mode, cruise, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation("cruise");

  // In edit mode the email parser makes no sense (the cruise already exists),
  // so open directly on the manual tab. For create mode we still default to
  // manual because the parser is a stub — the tab is shown so that users
  // discover the upcoming feature.
  const [tab, setTab] = useState<EntryTab>("manual");

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
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--bg-base)] shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--bg-base)] px-6 py-4">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            {mode === "create" ? t("form.createTitle") : t("form.editTitle")}
          </h2>
        </div>

        {/* Tab bar — E-Mail-Parser | Manuell, mirrors FlightsTablePage */}
        <div
          className="flex border-b"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--color-border)",
          }}
        >
          <button
            type="button"
            onClick={(): void => setTab("email")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "email"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            ✉ {t("tabs.emailParser")}
          </button>
          <button
            type="button"
            onClick={(): void => setTab("manual")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "manual"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            ✏ {t("tabs.manual")}
          </button>
        </div>

        <div className="p-6">
          {tab === "email" ? (
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border)] bg-[var(--bg-surface)]/50 px-6 py-10 text-center">
              <div
                aria-hidden
                className="mb-3 flex h-14 w-14 items-center justify-center rounded-full text-2xl"
                style={{ backgroundColor: "var(--bg-elevated)", color: "var(--accent)" }}
              >
                ✉
              </div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                {t("tabs.emailParserTitle")}
              </h3>
              <p className="mt-2 max-w-md text-sm text-[var(--text-muted)]">
                {t("tabs.emailParserHint")}
              </p>
              <button
                type="button"
                onClick={(): void => setTab("manual")}
                className="mt-5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)]"
              >
                {t("tabs.manual")}
              </button>
            </div>
          ) : (
            <>
              <Section title={`${t("field.ship")} & ${t("field.line")}`}>
                <ShipPicker value={ship} onChange={onShipPicked} />
                <input
                  className={`mt-3 ${INPUT_CLASS}`}
                  aria-label={t("field.line")}
                  value={cruiseLine}
                  onChange={(e): void => setCruiseLine(e.target.value)}
                  placeholder={t("field.line")}
                />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <input
                    type="datetime-local"
                    aria-label={t("field.depart")}
                    className={INPUT_CLASS}
                    value={startDate}
                    onChange={(e): void => setStartDate(e.target.value)}
                  />
                  <input
                    type="datetime-local"
                    aria-label={t("field.arrive")}
                    className={INPUT_CLASS}
                    value={endDate}
                    onChange={(e): void => setEndDate(e.target.value)}
                  />
                </div>
                <select
                  aria-label="status"
                  className={`mt-3 ${INPUT_CLASS}`}
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
                <div className="grid grid-cols-2 gap-3">
                  <PortPicker value={departurePort} onChange={setDeparturePort} />
                  <PortPicker value={arrivalPort} onChange={setArrivalPort} />
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
                    step={0.01}
                    aria-label={t("field.price")}
                    className={INPUT_CLASS}
                    value={price}
                    onChange={(e): void => setPrice(e.target.value)}
                    placeholder={t("field.price")}
                  />
                  <select
                    aria-label="currency"
                    className={INPUT_CLASS}
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
                  className={INPUT_CLASS}
                  value={tagsInput}
                  onChange={(e): void => setTagsInput(e.target.value)}
                  placeholder={t("field.tags")}
                />
                <input
                  aria-label={t("field.companions")}
                  className={`mt-3 ${INPUT_CLASS}`}
                  value={companionsInput}
                  onChange={(e): void => setCompanionsInput(e.target.value)}
                  placeholder={t("field.companions")}
                />
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
                <div className="mb-3 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — always visible, buttons fire only the active tab's action */}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--bg-base)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
          >
            {t("form.cancel")}
          </button>
          {tab === "manual" && (
            <button
              type="button"
              onClick={(): void => {
                void submit();
              }}
              disabled={saving}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
            >
              {saving ? t("form.saving") : t("form.save")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <details
      open
      className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)]/50 p-3"
    >
      <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
