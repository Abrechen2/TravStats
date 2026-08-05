import { useEffect, useState } from "react";
import type { TripStop } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { LocationInput } from "../location/LocationInput";
import type { LocationCoordinates, LocationSelection } from "../location/LocationInput";

interface StopModalProps {
  tripId: string;
  stop: TripStop | null; // null = create
  defaultDate?: string; // pre-fill startDate when creating
  onClose: () => void;
  onSaved: () => void;
}

const STOP_DOMAINS = ["poi", "hotel", "train", "road", "ferry", "hike", "bike", "other"] as const;

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromDateInput(value: string): string | null {
  if (!value) return null;
  return new Date(value + "T00:00:00.000Z").toISOString();
}

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
  const [startDate, setStartDate] = useState(toDateInput(stop?.startDate ?? defaultDate ?? null));
  const [endDate, setEndDate] = useState(toDateInput(stop?.endDate ?? null));
  const [lat, setLat] = useState<number | null>(stop?.lat ?? null);
  const [lon, setLon] = useState<number | null>(stop?.lon ?? null);
  const [notes, setNotes] = useState(stop?.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!stop) return;
    setTitle(stop.title);
    setDomain(stop.domain ?? "poi");
    setStartDate(toDateInput(stop.startDate));
    setEndDate(toDateInput(stop.endDate));
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
          startDate: fromDateInput(startDate),
          endDate: fromDateInput(endDate),
          lat,
          lon,
          notes: notes.trim() || null,
        });
      } else {
        await tripsApi.createStop(tripId, {
          title: title.trim(),
          domain,
          startDate: fromDateInput(startDate) ?? undefined,
          endDate: fromDateInput(endDate) ?? undefined,
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
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("trips:stopModal.startDateLabel")}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
            <Field label={t("trips:stopModal.endDateLabel")}>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
          </div>
          <div>
            <LocationInput value={position} onChange={handleLocationChange} />
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
            disabled={!title.trim() || saving}
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
