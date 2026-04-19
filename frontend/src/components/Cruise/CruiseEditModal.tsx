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
type Step = "chooser" | "manual" | "email";

interface Props {
  mode: Mode;
  cruise?: Cruise;
  onClose: () => void;
  onSaved: (saved: Cruise) => void | Promise<void>;
}

const STATUSES: CruiseStatus[] = ["scheduled", "flown", "cancelled", "historical"];
const CABIN_TYPES: CabinType[] = ["inside", "oceanview", "balcony", "suite"];
const CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return "";
  return iso.slice(0, 16);
};

const fromLocalInput = (local: string): string | null => {
  if (!local) return null;
  return new Date(local).toISOString();
};

const splitCsv = (v: string): string[] =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-3 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none";

// color-scheme: dark tells the browser to render native picker widgets
// (calendar icon, spinners) in dark mode colors. Without it, datetime-local
// inputs render the TT.MM.JJJJ placeholder mask in a nearly-black color
// that is unreadable on our dark surface.
const DARK_PICKER_STYLE: React.CSSProperties = { colorScheme: "dark" };

/**
 * Modal for creating or editing a cruise. On create, it opens on a chooser
 * step with two large buttons (email parser / manual entry) mirroring the
 * flight form. Edit mode skips the chooser and opens on the manual form.
 */
export function CruiseEditModal({ mode, cruise, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation("cruise");

  const [step, setStep] = useState<Step>(mode === "edit" ? "manual" : "chooser");

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
          : await cruiseApi.update((cruise as Cruise).id, input);
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

  const headerTitle =
    step === "chooser"
      ? t("chooser.title")
      : mode === "create"
        ? t("form.createTitle")
        : t("form.editTitle");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--bg-base)] shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--bg-base)] px-6 py-4">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">{headerTitle}</h2>
          {step !== "chooser" && mode === "create" && (
            <button
              type="button"
              onClick={(): void => setStep("chooser")}
              className="mt-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
            >
              {t("chooser.back")}
            </button>
          )}
        </div>

        {step === "chooser" && (
          <ChooserStep
            onPickEmail={(): void => setStep("email")}
            onPickManual={(): void => setStep("manual")}
            t={t}
          />
        )}

        {step === "email" && (
          <div className="p-6">
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border)] bg-[var(--bg-surface)]/50 px-6 py-12 text-center">
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
                onClick={(): void => setStep("manual")}
                className="mt-5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-dim)]"
              >
                {t("chooser.manual.label")}
              </button>
            </div>
          </div>
        )}

        {step === "manual" && (
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
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <input
                    type="datetime-local"
                    aria-label={t("field.depart")}
                    className={INPUT_CLASS}
                    style={DARK_PICKER_STYLE}
                    value={startDate}
                    onChange={(e): void => setStartDate(e.target.value)}
                  />
                  <input
                    type="datetime-local"
                    aria-label={t("field.arrive")}
                    className={INPUT_CLASS}
                    style={DARK_PICKER_STYLE}
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
            </div>

            {/* Footer with action buttons — only on manual step */}
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--bg-base)] px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
              >
                {t("form.cancel")}
              </button>
              <button
                type="button"
                onClick={(): void => {
                  void submit();
                }}
                disabled={saving}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-dim)] disabled:opacity-50"
              >
                {saving ? t("form.saving") : t("form.save")}
              </button>
            </div>
          </>
        )}

        {/* Footer for non-manual steps — just Cancel */}
        {step !== "manual" && (
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--bg-base)] px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
            >
              {t("form.cancel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ChooserProps {
  onPickEmail: () => void;
  onPickManual: () => void;
  t: (key: string) => string;
}

/**
 * First step of the create flow. Mirrors the visual hierarchy of the flight
 * entry form (FlightLookupStep): a large green hero card for the primary
 * import path, then a smaller secondary card for the fallback action. The
 * email card carries a yellow "coming soon" badge (parser is a 501 stub);
 * clicking it surfaces a placeholder step rather than silently failing.
 * Manual entry is rendered as the secondary card — smaller, subtler, but
 * still fully actionable because it's the only working path today.
 */
function ChooserStep({ onPickEmail, onPickManual, t }: ChooserProps): JSX.Element {
  return (
    <div className="space-y-4 p-6">
      {/* Email hero card — matches FlightLookupStep green-900→teal-900 gradient */}
      <div className="rounded-xl border-2 border-green-600 bg-gradient-to-r from-green-900 to-teal-900 p-6 shadow-lg shadow-green-900/50 ring-2 ring-green-500/30 transition-all duration-300 hover:scale-[1.01] hover:shadow-xl hover:shadow-green-900/70">
        <div className="flex items-start gap-4">
          <div className="flex flex-shrink-0 flex-col items-start gap-2">
            <span className="inline-flex items-center rounded-full bg-yellow-500 px-3 py-1 text-xs font-bold text-[var(--text-primary)] shadow-md">
              ⏳ {t("chooser.email.badge")}
            </span>
            <div className="text-4xl text-green-300" aria-hidden>
              📧
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="mb-2 text-2xl font-bold text-[var(--text-primary)]">
              {t("chooser.email.label")}
            </h3>
            <p className="mb-4 text-base font-medium text-[var(--text-muted)]">
              {t("chooser.email.description")}
            </p>
            <p className="flex items-center gap-2 text-sm font-semibold text-green-300">
              <span className="text-lg text-green-400">✓</span>
              {t("chooser.email.infoLine")}
            </p>
          </div>

          <div className="flex-shrink-0">
            <button
              type="button"
              onClick={onPickEmail}
              className="btn-primary flex items-center gap-2 whitespace-nowrap px-6 py-3 text-base font-semibold shadow-md transition-transform duration-200 hover:scale-105 hover:shadow-lg"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              {t("chooser.email.cta")}
            </button>
          </div>
        </div>
      </div>

      {/* Manual entry secondary card — matches FlightLookupStep boarding-pass style */}
      <div className="rounded-lg border border-blue-700 bg-gradient-to-r from-[var(--bg-elevated)] to-[var(--bg-muted)] p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="text-3xl" aria-hidden>
              ✏️
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                {t("chooser.manual.label")}
              </h3>
              <p className="text-sm text-[var(--text-muted)]">{t("chooser.manual.description")}</p>
            </div>
          </div>
          <button type="button" onClick={onPickManual} className="btn-primary">
            {t("chooser.manual.cta")}
          </button>
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
