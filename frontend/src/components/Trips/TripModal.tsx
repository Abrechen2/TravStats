import { useState, useEffect } from "react";
import type { Trip, TripCategory, TripStatus } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { TRIP_COLORS as PALETTE } from "../../lib/tripColors";

interface TripModalProps {
  trip: Trip | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

const STATUSES: TripStatus[] = ["planned", "in_progress", "completed"];
const CATEGORIES: TripCategory[] = ["vacation", "business", "weekend", "family", "other"];

const CATEGORY_ICON: Record<TripCategory, string> = {
  vacation: "🏖",
  business: "💼",
  weekend: "🎒",
  family: "👨‍👩‍👧",
  other: "🗺",
};

// Convert ISO date string ↔ <input type="date"> "YYYY-MM-DD" form. Local
// timezone is fine here — trip dates are calendar dates, not instants.
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromDateInput(value: string): string | null {
  if (!value) return null;
  return new Date(value + "T00:00:00.000Z").toISOString();
}

function csvFromArray(arr: string[]): string {
  return arr.join(", ");
}

function arrayFromCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function TripModal({ trip, onClose, onSaved }: TripModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [name, setName] = useState(trip?.name ?? "");
  const [description, setDescription] = useState(trip?.description ?? "");
  const [color, setColor] = useState(trip?.color ?? PALETTE[0]);
  const [status, setStatus] = useState<TripStatus>(trip?.status ?? "completed");
  const [category, setCategory] = useState<TripCategory | "">(trip?.category ?? "");
  const [startDate, setStartDate] = useState(toDateInput(trip?.startDate ?? null));
  const [endDate, setEndDate] = useState(toDateInput(trip?.endDate ?? null));
  const [originLabel, setOriginLabel] = useState(trip?.originLabel ?? "");
  const [destinationLabel, setDestinationLabel] = useState(trip?.destinationLabel ?? "");
  const [tagsCsv, setTagsCsv] = useState(csvFromArray(trip?.tags ?? []));
  const [companionsCsv, setCompanionsCsv] = useState(csvFromArray(trip?.companions ?? []));
  const [notes, setNotes] = useState(trip?.notes ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(trip?.coverImageUrl ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!trip) return;
    setName(trip.name);
    setDescription(trip.description ?? "");
    setColor(trip.color);
    setStatus(trip.status);
    setCategory(trip.category ?? "");
    setStartDate(toDateInput(trip.startDate));
    setEndDate(toDateInput(trip.endDate));
    setOriginLabel(trip.originLabel ?? "");
    setDestinationLabel(trip.destinationLabel ?? "");
    setTagsCsv(csvFromArray(trip.tags));
    setCompanionsCsv(csvFromArray(trip.companions));
    setNotes(trip.notes ?? "");
    setCoverImageUrl(trip.coverImageUrl ?? "");
  }, [trip]);

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Shared payload. PATCH-semantics handle null vs undefined: send
      // `null` to clear, omit to leave untouched.
      if (trip) {
        await tripsApi.update(trip.id, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          status,
          category: category === "" ? null : category,
          startDate: fromDateInput(startDate),
          endDate: fromDateInput(endDate),
          originLabel: originLabel.trim() || null,
          destinationLabel: destinationLabel.trim() || null,
          tags: arrayFromCsv(tagsCsv),
          companions: arrayFromCsv(companionsCsv),
          notes: notes.trim() || null,
          coverImageUrl: coverImageUrl.trim() || null,
        });
        addToast("success", t("trips:toasts.updated"));
      } else {
        await tripsApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          status,
          category: category === "" ? undefined : category,
          startDate: fromDateInput(startDate) ?? undefined,
          endDate: fromDateInput(endDate) ?? undefined,
          originLabel: originLabel.trim() || undefined,
          destinationLabel: destinationLabel.trim() || undefined,
          tags: arrayFromCsv(tagsCsv),
          companions: arrayFromCsv(companionsCsv),
          notes: notes.trim() || undefined,
          coverImageUrl: coverImageUrl.trim() || undefined,
        });
        addToast("success", t("trips:toasts.created"));
      }
      onSaved();
    } catch {
      addToast("error", trip ? t("trips:toasts.updateError") : t("trips:toasts.createError"));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-input, var(--bg-base))",
    border: "1px solid var(--color-border)",
    color: "var(--text-primary)",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="p-5 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {trip ? t("trips:editTrip") : t("trips:createTrip")}
          </h2>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <Field label={t("trips:modal.nameLabel")}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("trips:modal.namePlaceholder")}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("trips:modal.statusLabel", { defaultValue: "Status" })}
            >
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TripStatus)}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`trips:status.${s}`, {
                      defaultValue:
                        s === "planned"
                          ? "Geplant"
                          : s === "in_progress"
                            ? "Aktuell"
                            : "Abgeschlossen",
                    })}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("trips:modal.categoryLabel", { defaultValue: "Kategorie" })}
            >
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TripCategory | "")}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              >
                <option value="">—</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_ICON[c]}{" "}
                    {t(`trips:category.${c}`, {
                      defaultValue:
                        c === "vacation"
                          ? "Urlaub"
                          : c === "business"
                            ? "Geschäft"
                            : c === "weekend"
                              ? "Wochenende"
                              : c === "family"
                                ? "Familie"
                                : "Sonstiges",
                    })}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("trips:modal.startDateLabel", { defaultValue: "Startdatum" })}
            >
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
            <Field
              label={t("trips:modal.endDateLabel", { defaultValue: "Enddatum" })}
            >
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("trips:modal.originLabel", { defaultValue: "Herkunft" })}
            >
              <input
                value={originLabel}
                onChange={(e) => setOriginLabel(e.target.value)}
                placeholder="München"
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
            <Field
              label={t("trips:modal.destinationLabel", { defaultValue: "Ziel" })}
            >
              <input
                value={destinationLabel}
                onChange={(e) => setDestinationLabel(e.target.value)}
                placeholder="Tokyo, Japan"
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
          </div>

          <Field
            label={t("trips:modal.tagsLabel", {
              defaultValue: "Tags (kommagetrennt)",
            })}
          >
            <input
              value={tagsCsv}
              onChange={(e) => setTagsCsv(e.target.value)}
              placeholder="kultur, food, fotos"
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            />
          </Field>

          <Field
            label={t("trips:modal.companionsLabel", {
              defaultValue: "Mitreisende (kommagetrennt)",
            })}
          >
            <input
              value={companionsCsv}
              onChange={(e) => setCompanionsCsv(e.target.value)}
              placeholder="Marie, Tom"
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            />
          </Field>

          <Field
            label={t("trips:modal.coverLabel", { defaultValue: "Coverbild-URL" })}
          >
            <input
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="https://… / /uploads/…"
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            />
          </Field>

          <Field
            label={t("trips:modal.notesLabel", {
              defaultValue: "Notizen (Markdown)",
            })}
          >
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("trips:modal.notesPlaceholder", {
                defaultValue: "Längere Notizen über die Reise …",
              })}
              rows={4}
              className="w-full rounded-lg px-3 py-2 text-sm resize-none"
              style={inputStyle}
            />
          </Field>

          <Field
            label={t("trips:modal.descLabel")}
            hint={t("trips:modal.descHint", {
              defaultValue: "Kurze Beschreibung — erscheint auf der Karte.",
            })}
          >
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("trips:modal.descPlaceholder")}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-sm resize-none"
              style={inputStyle}
            />
          </Field>

          <Field label={t("trips:modal.colorLabel")}>
            <div className="flex gap-2 flex-wrap">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  aria-pressed={color === c}
                  type="button"
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: color === c ? `2px solid ${c}` : "none",
                    outlineOffset: "2px",
                  }}
                />
              ))}
            </div>
          </Field>
        </div>

        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:modal.cancel")}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!name.trim() || saving}
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-50"
          >
            {saving ? "…" : t("trips:modal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps): JSX.Element {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide mb-1.5"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
