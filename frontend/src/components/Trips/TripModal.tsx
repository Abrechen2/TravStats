import { useState, useEffect, useRef } from "react";
import type { Trip, TripCategory } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { TRIP_COLORS as PALETTE } from "../../lib/tripColors";
import CompanionPicker from "../CompanionPicker";

interface TripModalProps {
  trip: Trip | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES: TripCategory[] = ["vacation", "business", "weekend", "family", "other"];

const CATEGORY_ICON: Record<TripCategory, string> = {
  vacation: "🏖",
  business: "💼",
  weekend: "🎒",
  family: "👨‍👩‍👧",
  other: "🗺",
};

type ModalTab = "general" | "people" | "appearance" | "notes";

const TABS: ReadonlyArray<{ id: ModalTab; icon: string }> = [
  { id: "general", icon: "📋" },
  { id: "people", icon: "👥" },
  { id: "appearance", icon: "🎨" },
  { id: "notes", icon: "📝" },
];

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

  const [tab, setTab] = useState<ModalTab>("general");
  const [name, setName] = useState(trip?.name ?? "");
  const [description, setDescription] = useState(trip?.description ?? "");
  const [color, setColor] = useState(trip?.color ?? PALETTE[0]);
  const [category, setCategory] = useState<TripCategory | "">(trip?.category ?? "");
  const [startDate, setStartDate] = useState(toDateInput(trip?.startDate ?? null));
  const [endDate, setEndDate] = useState(toDateInput(trip?.endDate ?? null));
  const [originLabel, setOriginLabel] = useState(trip?.originLabel ?? "");
  const [destinationLabel, setDestinationLabel] = useState(trip?.destinationLabel ?? "");
  const [tagsCsv, setTagsCsv] = useState(csvFromArray(trip?.tags ?? []));
  const [companions, setCompanions] = useState<string[]>(trip?.companions ?? []);
  const [notes, setNotes] = useState(trip?.notes ?? "");
  // Cover is upload-only. The chosen file is buffered and uploaded on save,
  // so it works even while creating a brand-new trip (before an id exists).
  // `coverUrl` holds the existing server cover; `coverFile`/`coverPreview`
  // hold a pending local pick; `removeCover` marks an explicit clear.
  const [coverUrl, setCoverUrl] = useState(trip?.coverImageUrl ?? "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Release the object URL of a pending pick when it changes or on unmount.
  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const handlePickCover = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
    setRemoveCover(false);
  };

  const handleRemoveCover = (): void => {
    setCoverFile(null);
    setCoverPreview(null);
    setCoverUrl("");
    setRemoveCover(true);
  };

  useEffect(() => {
    if (!trip) return;
    setName(trip.name);
    setDescription(trip.description ?? "");
    setColor(trip.color);
    setCategory(trip.category ?? "");
    setStartDate(toDateInput(trip.startDate));
    setEndDate(toDateInput(trip.endDate));
    setOriginLabel(trip.originLabel ?? "");
    setDestinationLabel(trip.destinationLabel ?? "");
    setTagsCsv(csvFromArray(trip.tags));
    setCompanions(trip.companions);
    setNotes(trip.notes ?? "");
    setCoverUrl(trip.coverImageUrl ?? "");
    setCoverFile(null);
    setCoverPreview(null);
    setRemoveCover(false);
  }, [trip]);

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // The cover image is never sent as a field here — it's uploaded
      // separately below. We only touch coverImageUrl to clear an existing
      // cover when the user explicitly removed it.
      let savedTrip: Trip;
      if (trip) {
        savedTrip = await tripsApi.update(trip.id, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          category: category === "" ? null : category,
          startDate: fromDateInput(startDate),
          endDate: fromDateInput(endDate),
          originLabel: originLabel.trim() || null,
          destinationLabel: destinationLabel.trim() || null,
          tags: arrayFromCsv(tagsCsv),
          companions,
          notes: notes.trim() || null,
          ...(removeCover ? { coverImageUrl: null } : {}),
        });
      } else {
        savedTrip = await tripsApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          category: category === "" ? undefined : category,
          startDate: fromDateInput(startDate) ?? undefined,
          endDate: fromDateInput(endDate) ?? undefined,
          originLabel: originLabel.trim() || undefined,
          destinationLabel: destinationLabel.trim() || undefined,
          tags: arrayFromCsv(tagsCsv),
          companions,
          notes: notes.trim() || undefined,
        });
      }

      // Upload a freshly picked cover against the now-guaranteed trip id.
      // A failure here shouldn't lose the saved trip data — surface a
      // cover-specific error but still treat the save as done.
      if (coverFile) {
        setUploadingCover(true);
        try {
          await tripsApi.uploadCover(savedTrip.id, coverFile);
        } catch {
          addToast("error", t("trips:gallery.uploadError"));
        } finally {
          setUploadingCover(false);
        }
      }

      addToast("success", trip ? t("trips:toasts.updated") : t("trips:toasts.created"));
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

        <div
          className="flex gap-1 px-3 pt-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
          role="tablist"
        >
          {TABS.map((tDef) => {
            const active = tab === tDef.id;
            return (
              <button
                key={tDef.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tDef.id)}
                className="px-3 py-2 text-sm rounded-t-md transition-colors flex items-center gap-1.5"
                style={{
                  background: active ? "var(--bg-surface)" : "transparent",
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: active ? 600 : 400,
                  marginBottom: "-1px",
                }}
              >
                <span>{tDef.icon}</span>
                <span>{t(`trips:modalTabs.${tDef.id}`)}</span>
              </button>
            );
          })}
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {tab === "general" && (
            <>
              <Field label={t("trips:modal.nameLabel")}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("trips:modal.namePlaceholder")}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={inputStyle}
                />
              </Field>

              {/* #status-from-dates: trip status now derives from linked
                  segment dates (deriveTripStatus) — there is no manual
                  control here, and no "cancelled" concept for trips. */}
              <Field label={t("trips:modal.categoryLabel")}>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TripCategory | "")}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={inputStyle}
                >
                  <option value="">—</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_ICON[c]} {t(`trips:category.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t("trips:modal.startDateLabel")}>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={inputStyle}
                  />
                </Field>
                <Field label={t("trips:modal.endDateLabel")}>
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
                <Field label={t("trips:modal.originLabel")}>
                  <input
                    value={originLabel}
                    onChange={(e) => setOriginLabel(e.target.value)}
                    placeholder="München"
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={inputStyle}
                  />
                </Field>
                <Field label={t("trips:modal.destinationLabel")}>
                  <input
                    value={destinationLabel}
                    onChange={(e) => setDestinationLabel(e.target.value)}
                    placeholder="Tokyo, Japan"
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={inputStyle}
                  />
                </Field>
              </div>

              <Field label={t("trips:modal.descLabel")} hint={t("trips:modal.descHint")}>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("trips:modal.descPlaceholder")}
                  rows={2}
                  className="w-full rounded-lg px-3 py-2 text-sm resize-none"
                  style={inputStyle}
                />
              </Field>
            </>
          )}

          {tab === "people" && (
            <>
              <Field label={t("trips:modal.companionsLabel")}>
                <CompanionPicker value={companions} onChange={setCompanions} />
              </Field>

              <Field label={t("trips:modal.tagsLabel")}>
                <input
                  value={tagsCsv}
                  onChange={(e) => setTagsCsv(e.target.value)}
                  placeholder="kultur, food, fotos"
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={inputStyle}
                />
              </Field>
              <TagPreview values={arrayFromCsv(tagsCsv)} accent={color} />
            </>
          )}

          {tab === "appearance" && (
            <>
              <Field label={t("trips:modal.coverLabel")}>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handlePickCover}
                />
                <CoverPreview
                  url={coverPreview ?? coverUrl}
                  accent={color}
                  title={name || "—"}
                  onClick={() => coverInputRef.current?.click()}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={uploadingCover}
                    className="px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                    style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                  >
                    {uploadingCover
                      ? "…"
                      : coverPreview || coverUrl
                        ? t("trips:modal.coverUploadReplace")
                        : t("trips:modal.coverUploadButton")}
                  </button>
                  {(coverPreview || coverUrl) && (
                    <button
                      type="button"
                      onClick={handleRemoveCover}
                      disabled={uploadingCover}
                      className="px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                      style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
                    >
                      {t("trips:modal.coverRemove")}
                    </button>
                  )}
                </div>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                  {coverFile && !trip
                    ? t("trips:modal.coverPending")
                    : t("trips:modal.coverUploadReady")}
                </p>
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
            </>
          )}

          {tab === "notes" && (
            <Field label={t("trips:modal.notesLabel")} hint={t("trips:modal.notesMarkdownHint")}>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("trips:modal.notesPlaceholder")}
                rows={14}
                className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
                style={inputStyle}
              />
            </Field>
          )}
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
            className="px-4 py-2 rounded-lg text-sm font-medium bg-(--accent) text-(--bg-base) disabled:opacity-50"
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
      <label
        className="block text-xs font-medium uppercase tracking-wide mb-1.5"
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

interface CoverPreviewProps {
  url: string;
  accent: string;
  title: string;
  onClick?: () => void;
}

function CoverPreview({ url, accent, title, onClick }: CoverPreviewProps): JSX.Element {
  const trimmed = url.trim();
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`rounded-lg overflow-hidden h-32 relative flex items-end p-3${onClick ? " cursor-pointer" : ""}`}
      style={{
        background: trimmed
          ? `url(${JSON.stringify(trimmed)}) center/cover`
          : `linear-gradient(135deg, ${accent}40, ${accent}10)`,
        border: "1px solid var(--color-border)",
      }}
    >
      {!trimmed && (
        <div
          className="absolute inset-0 flex items-center justify-center text-3xl opacity-40"
          aria-hidden
        >
          🌍
        </div>
      )}
      <div
        className="relative font-display font-bold text-lg drop-shadow-lg"
        style={{ color: trimmed ? "#fff" : "var(--text-primary)" }}
      >
        {title}
      </div>
    </div>
  );
}

function TagPreview({ values, accent }: { values: string[]; accent: string }): JSX.Element | null {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span
          key={v}
          className="px-2.5 py-1 rounded-full text-xs"
          style={{
            background: `${accent}1f`,
            border: `1px solid ${accent}66`,
            color: accent,
          }}
        >
          #{v}
        </span>
      ))}
    </div>
  );
}
