import { useEffect, useState } from "react";
import type { TripStop } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { LocationInput } from "../location/LocationInput";
import type { LocationCoordinates, LocationSelection } from "../location/LocationInput";
import { joinDateTimeInput, splitDateTimeInput } from "../../lib/tripTimeline";

interface StopModalProps {
  tripId: string;
  stop: TripStop | null; // null = create
  defaultDate?: string; // pre-fill startDate when creating
  onClose: () => void;
  onSaved: () => void;
}

const STOP_DOMAINS = ["poi", "hotel", "train", "road", "ferry", "hike", "bike", "other"] as const;

// Date/time conversion lives in lib/tripTimeline.ts — read the time model at
// the top of that file before touching anything here. The short version: a
// stop's time is a wall clock at the PLACE, stored timezone-naive pinned to
// UTC, so what the user types round-trips exactly for every viewer.

export default function StopModal({
  tripId,
  stop,
  defaultDate,
  onClose,
  onSaved,
}: StopModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "location"]);
  const addToast = useToastStore((s) => s.addToast);

  const [title, setTitle] = useState(stop?.title ?? "");
  const [domain, setDomain] = useState<string>(stop?.domain ?? "poi");
  const initialStart = splitDateTimeInput(stop?.startDate ?? defaultDate ?? null);
  const initialEnd = splitDateTimeInput(stop?.endDate ?? null);
  const [startDate, setStartDate] = useState(initialStart.date);
  const [startTime, setStartTime] = useState(initialStart.time);
  const [endDate, setEndDate] = useState(initialEnd.date);
  const [endTime, setEndTime] = useState(initialEnd.time);
  const [lat, setLat] = useState<number | null>(stop?.lat ?? null);
  const [lon, setLon] = useState<number | null>(stop?.lon ?? null);
  const [notes, setNotes] = useState(stop?.notes ?? "");
  const [saving, setSaving] = useState(false);
  // Forgejo #9: out-of-range coordinates used to vanish silently and the
  // record saved without them. LocationInput now says so; this stops the
  // form writing while the user is looking at that message.
  const [coordsValid, setCoordsValid] = useState(true);

  useEffect(() => {
    if (!stop) return;
    setTitle(stop.title);
    setDomain(stop.domain ?? "poi");
    const start = splitDateTimeInput(stop.startDate);
    const end = splitDateTimeInput(stop.endDate);
    setStartDate(start.date);
    setStartTime(start.time);
    setEndDate(end.date);
    setEndTime(end.time);
    setNotes(stop.notes ?? "");
  }, [stop]);

  const position: LocationCoordinates | null = lat !== null && lon !== null ? { lat, lon } : null;

  // A selection always reports the picked position (search hit, coordinate
  // paste, map drag/click, or the advanced raw-input panel). It only fills
  // `title` while the user hasn't typed one yet — mirrors LodgingFormModal's
  // `handleLocationChange` (Task 4) so a search selection never overwrites
  // text the user already entered.
  const handleLocationChange = (selection: LocationSelection): void => {
    setLat(selection.lat);
    setLon(selection.lon);
    if (selection.name && title.trim().length === 0) setTitle(selection.name);
  };

  const handleClearPosition = (): void => {
    setLat(null);
    setLon(null);
  };

  const handleSave = async (): Promise<void> => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (stop) {
        await tripsApi.updateStop(tripId, stop.id, {
          title: title.trim(),
          domain,
          startDate: joinDateTimeInput(startDate, startTime),
          endDate: joinDateTimeInput(endDate, endTime),
          lat,
          lon,
          notes: notes.trim() || null,
        });
      } else {
        await tripsApi.createStop(tripId, {
          title: title.trim(),
          domain,
          startDate: joinDateTimeInput(startDate, startTime) ?? undefined,
          endDate: joinDateTimeInput(endDate, endTime) ?? undefined,
          lat: lat ?? undefined,
          lon: lon ?? undefined,
          notes: notes.trim() || undefined,
        });
      }
      onSaved();
    } catch {
      addToast("error", stop ? t("trips:toasts.updateError") : t("trips:toasts.createError"));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-base)",
    border: "1px solid var(--color-border)",
    color: "var(--text-primary)",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-xl rounded-xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="p-5 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-lg font-semibold">
            {stop ? t("trips:stopModal.editTitle") : t("trips:stopModal.createTitle")}
          </h2>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <Field label={t("trips:stopModal.titleLabel")}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("trips:stopModal.titlePlaceholder")}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            />
          </Field>
          <Field label={t("trips:stopModal.domainLabel")}>
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            >
              {STOP_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {t(`trips:stopModal.domainOptions.${d}`)}
                </option>
              ))}
            </select>
          </Field>
          {/* Time SITS NEXT TO the date rather than replacing it with a
              datetime input (#175, Alex's own wording). A datetime-local field
              is all-or-nothing, which would force a time on every stop that
              only ever needed a day. Left blank, the stop stays date-only. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("trips:stopModal.startDateLabel")}>
              <div className="flex gap-2">
                <input
                  type="date"
                  aria-label={t("trips:stopModal.startDateLabel")}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={inputStyle}
                />
                <input
                  type="time"
                  aria-label={t("trips:stopModal.startTimeLabel")}
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-28 shrink-0 rounded-lg px-3 py-2 text-sm"
                  style={inputStyle}
                />
              </div>
            </Field>
            <Field label={t("trips:stopModal.endDateLabel")}>
              <div className="flex gap-2">
                <input
                  type="date"
                  aria-label={t("trips:stopModal.endDateLabel")}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={inputStyle}
                />
                <input
                  type="time"
                  aria-label={t("trips:stopModal.endTimeLabel")}
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-28 shrink-0 rounded-lg px-3 py-2 text-sm"
                  style={inputStyle}
                />
              </div>
            </Field>
          </div>
          <p className="-mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {t("trips:stopModal.timeHint")}
          </p>
          <div>
            <LocationInput
              value={position}
              onChange={handleLocationChange}
              onValidityChange={setCoordsValid}
            />
            {position !== null && (
              <button
                type="button"
                onClick={handleClearPosition}
                className="mt-1 text-xs hover:underline"
                style={{ color: "var(--text-muted)" }}
              >
                {t("location:clear")}
              </button>
            )}
          </div>
          <Field label={t("trips:stopModal.notesLabel")}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm resize-vertical"
              style={inputStyle}
            />
          </Field>
        </div>
        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:stopModal.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!title.trim() || saving || !coordsValid}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-(--accent) text-(--bg-base) disabled:opacity-50"
          >
            {saving ? "…" : t("trips:stopModal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <label
        className="block text-xs font-medium uppercase tracking-wide mb-1.5"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
