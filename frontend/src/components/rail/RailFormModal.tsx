import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import Modal from "../Modal";
import CurrencySelect from "../common/CurrencySelect";
import CompanionPicker from "../CompanionPicker";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useTranslation } from "../../hooks/useTranslation";
import { minorUnits } from "../../shared/currencies";
import { railApi } from "../../lib/api/rail";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import type { Trip } from "../../types";
import { RAIL_TRAVEL_CLASSES, type RailJourney, type RailTravelClass } from "../../types/rail";
import { StationPicker } from "./StationPicker";
import { RailLookupPanel } from "./RailLookupPanel";
import {
  canSubmit,
  connectionDraftFrom,
  draftFrom,
  isStationComplete,
  toRailInput,
  type RailFormDraft,
} from "./railFormModel";

interface Props {
  journey: RailJourney | null;
  /** A prefilled new leg — the connection the detail page asked for. */
  initialDraft?: RailFormDraft;
  /** The leg a new journey continues; the server binds both via a booking. */
  connectsFrom?: string;
  onClose: () => void;
  onSaved: (saved: RailJourney) => void | Promise<void>;
  /**
   * Called when "save and add a connection" saved a leg and the dialog stays
   * open for the next one — the caller refreshes, but does not close.
   */
  onProgress?: (saved: RailJourney) => void | Promise<void>;
}

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden";

// Native date/time pickers render their mask unreadably dark on our surface
// without it — the same note the cruise form carries.
const DARK_PICKER_STYLE = { colorScheme: "dark" } as const;

/**
 * Create or edit one train ride (spec 2026-09-25-rail-domain, phase 1).
 *
 * Times are entered on each station's own clock and sent without an offset;
 * the server finds the zone from the station and stores the instant. The
 * status is not a field: it follows from the times, and only a cancellation
 * is the user's to state — the same rule the cruise form follows.
 */
export function RailFormModal({
  journey: initialJourney,
  initialDraft,
  connectsFrom: initialConnectsFrom,
  onClose,
  onSaved,
  onProgress,
}: Props): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const recentCurrencies = useRecentCurrencies();
  // The dialog can move on to the next leg without closing, so what it edits
  // and what it continues are state, seeded from the props.
  const [journey, setJourney] = useState<RailJourney | null>(initialJourney);
  const [connectsFrom, setConnectsFrom] = useState<RailJourney | string | undefined>(
    initialConnectsFrom
  );
  const [formKey, setFormKey] = useState(0);
  const [draft, setDraft] = useState<RailFormDraft>(
    () => initialDraft ?? draftFrom(initialJourney)
  );
  const [trips, setTrips] = useState<Trip[]>([]);
  const [depValid, setDepValid] = useState(true);
  const [arrValid, setArrValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RailFormDraft>(key: K, value: RailFormDraft[K]): void =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  // Non-fatal on purpose: without the list the field offers "no trip", which
  // beats taking the dialog down over a side lookup.
  useEffect(() => {
    let cancelled = false;
    tripsApi
      .getAll()
      .then((all) => {
        if (!cancelled) setTrips(all);
      })
      .catch((err: unknown) => logger.warn("RailFormModal: failed to load trips", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = canSubmit(draft) && depValid && arrValid;

  const previousId = typeof connectsFrom === "string" ? connectsFrom : connectsFrom?.id;
  const previousStation =
    typeof connectsFrom === "object" ? connectsFrom.arrStationName : draft.departure.name;

  const submit = async (thenConnect = false): Promise<void> => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const input = toRailInput(draft);
      const saved = journey
        ? await railApi.update(journey.id, input)
        : await railApi.create(previousId ? { ...input, connectsFrom: previousId } : input);
      if (!thenConnect) {
        await onSaved(saved);
        return;
      }
      // The next leg: from where this one arrives, after it arrives, in the
      // same trip and booking. The pickers remount so they show the new pick.
      await onProgress?.(saved);
      setJourney(null);
      setConnectsFrom(saved);
      setDraft(connectionDraftFrom(saved));
      setFormKey((k) => k + 1);
    } catch (err: unknown) {
      logger.error("RailFormModal: save failed", err);
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message ?? t("rail:form.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      closeLabel={t("common:buttons.close")}
      title={journey ? t("rail:form.editTitle") : t("rail:form.createTitle")}
      maxWidth={672}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
          >
            {t("rail:form.cancel")}
          </button>
          <button
            type="button"
            onClick={(): void => void submit(true)}
            disabled={saving || !ready}
            data-testid="rail-save-and-connect"
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-(--bg-surface) disabled:opacity-50"
          >
            {t("rail:connection.saveAndAdd")}
          </button>
          <button
            type="button"
            onClick={(): void => void submit()}
            disabled={saving || !ready}
            className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
          >
            {saving ? t("rail:form.saving") : t("rail:form.save")}
          </button>
        </>
      }
    >
      <div key={formKey}>
        {previousId && (
          <p
            className="mb-3 rounded-md border border-border px-3 py-2 text-sm"
            data-testid="rail-connection-banner"
          >
            {t("rail:connection.banner", { station: previousStation })}
          </p>
        )}
        <Section title={t("rail:form.train")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              className={INPUT_CLASS}
              aria-label={t("rail:form.operator")}
              placeholder={t("rail:form.operatorPlaceholder")}
              value={draft.operator}
              onChange={(e): void => set("operator", e.target.value)}
            />
            <input
              className={INPUT_CLASS}
              aria-label={t("rail:form.category")}
              placeholder={t("rail:form.categoryPlaceholder")}
              value={draft.trainCategory}
              onChange={(e): void => set("trainCategory", e.target.value)}
            />
            <input
              className={INPUT_CLASS}
              aria-label={t("rail:form.number")}
              placeholder={t("rail:form.numberPlaceholder")}
              value={draft.trainNumber}
              onChange={(e): void => set("trainNumber", e.target.value)}
            />
          </div>
        </Section>

        <RailLookupPanel
          draft={draft}
          onApply={setDraft}
          onClearLookup={(): void => set("lookup", null)}
          inputClassName={INPUT_CLASS}
        />

        <Section title={t("rail:form.route")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StationPicker
              label={t("rail:form.departureStation")}
              idPrefix="rail-dep"
              value={draft.departure}
              onChange={(next): void => set("departure", next)}
              onValidityChange={setDepValid}
              inputClassName={INPUT_CLASS}
            />
            <StationPicker
              label={t("rail:form.arrivalStation")}
              idPrefix="rail-arr"
              value={draft.arrival}
              onChange={(next): void => set("arrival", next)}
              onValidityChange={setArrValid}
              inputClassName={INPUT_CLASS}
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t("rail:form.departureTime")}
              <input
                type="datetime-local"
                className={`mt-1 ${INPUT_CLASS}`}
                style={DARK_PICKER_STYLE}
                value={draft.departureLocal}
                onChange={(e): void => set("departureLocal", e.target.value)}
              />
            </label>
            <label className="text-sm">
              {t("rail:form.arrivalTime")}
              <input
                type="datetime-local"
                className={`mt-1 ${INPUT_CLASS}`}
                style={DARK_PICKER_STYLE}
                value={draft.arrivalLocal}
                onChange={(e): void => set("arrivalLocal", e.target.value)}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-(--text-muted)">{t("rail:form.timeHint")}</p>
          <label className="mt-3 block text-sm">
            {t("rail:form.distance")}
            <input
              type="number"
              min={0}
              step="0.1"
              className={`mt-1 ${INPUT_CLASS}`}
              value={draft.distanceKm}
              onChange={(e): void => set("distanceKm", e.target.value)}
            />
          </label>
          <p className="mt-1 text-xs text-(--text-muted)">{t("rail:form.distanceHint")}</p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.cancelled}
              onChange={(e): void => set("cancelled", e.target.checked)}
            />
            {t("rail:status.cancelledCheckbox")}
          </label>
        </Section>

        <Section title={t("rail:form.seat")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <select
              aria-label={t("rail:form.class")}
              className={INPUT_CLASS}
              value={draft.travelClass}
              onChange={(e): void => set("travelClass", e.target.value as RailTravelClass | "")}
            >
              <option value="">{t("rail:form.class")}</option>
              {RAIL_TRAVEL_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {t(`rail:class.${c}`)}
                </option>
              ))}
            </select>
            <input
              className={INPUT_CLASS}
              aria-label={t("rail:form.coach")}
              placeholder={t("rail:form.coach")}
              value={draft.coach}
              onChange={(e): void => set("coach", e.target.value)}
            />
            <input
              className={INPUT_CLASS}
              aria-label={t("rail:form.seatNumber")}
              placeholder={t("rail:form.seatNumber")}
              value={draft.seat}
              onChange={(e): void => set("seat", e.target.value)}
            />
            <input
              type="number"
              className={INPUT_CLASS}
              aria-label={t("rail:form.delay")}
              placeholder={t("rail:form.delay")}
              value={draft.delayMinutes}
              onChange={(e): void => set("delayMinutes", e.target.value)}
            />
          </div>
        </Section>

        <Section title={t("rail:form.costs")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              className={INPUT_CLASS}
              aria-label={t("rail:form.bookingReference")}
              placeholder={t("rail:form.bookingReference")}
              value={draft.bookingReference}
              onChange={(e): void => set("bookingReference", e.target.value)}
            />
            <input
              type="number"
              min={0}
              step={10 ** -minorUnits(draft.currency)}
              className={INPUT_CLASS}
              aria-label={t("rail:form.price")}
              placeholder={t("rail:form.price")}
              value={draft.price}
              onChange={(e): void => set("price", e.target.value)}
            />
            <CurrencySelect
              aria-label={t("rail:form.currency")}
              value={draft.currency}
              recent={recentCurrencies}
              onChange={(code): void => set("currency", code)}
            />
          </div>
        </Section>

        <Section title={t("rail:form.meta")}>
          <input
            className={INPUT_CLASS}
            aria-label={t("rail:form.tags")}
            placeholder={t("rail:form.tags")}
            value={draft.tags}
            onChange={(e): void => set("tags", e.target.value)}
          />
          <div className="mt-3">
            <span className="label">{t("rail:form.companions")}</span>
            <CompanionPicker
              value={draft.companions}
              onChange={(next): void => set("companions", next)}
            />
          </div>
          <label className="mt-3 block text-sm">
            {t("rail:form.trip")}
            <select
              className={`mt-1 ${INPUT_CLASS}`}
              value={draft.tripId}
              onChange={(e): void => set("tripId", e.target.value)}
            >
              <option value="">{t("rail:form.noTrip")}</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            aria-label={t("rail:form.notes")}
            rows={3}
            className={`mt-3 ${INPUT_CLASS}`}
            placeholder={t("rail:form.notes")}
            value={draft.notes}
            onChange={(e): void => set("notes", e.target.value)}
          />
        </Section>

        {!(isStationComplete(draft.departure) && isStationComplete(draft.arrival)) && (
          <p className="mb-3 text-sm text-(--text-muted)">{t("rail:form.stationMissing")}</p>
        )}
        {error !== null && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-(--danger)/50 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)"
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <details open className="mb-4 rounded-md border border-border bg-(--bg-surface)/50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-(--text-primary)">
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
