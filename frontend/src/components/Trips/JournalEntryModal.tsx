import { useEffect, useState } from "react";
import type { TripJournalEntry } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

interface JournalEntryModalProps {
  tripId: string;
  entry: TripJournalEntry | null; // null = create
  defaultDate?: string; // pre-fill date when creating
  onClose: () => void;
  onSaved: () => void;
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromDateInput(value: string): string {
  // Trip-day journals are calendar dates — pin to UTC midnight so the
  // backend stores a stable instant regardless of the browser's TZ.
  return new Date(value + "T00:00:00.000Z").toISOString();
}

export default function JournalEntryModal({
  tripId,
  entry,
  defaultDate,
  onClose,
  onSaved,
}: JournalEntryModalProps): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const addToast = useToastStore((s) => s.addToast);

  const [date, setDate] = useState(
    toDateInput(entry?.date ?? defaultDate ?? new Date().toISOString())
  );
  const [title, setTitle] = useState(entry?.title ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [mood, setMood] = useState(entry?.mood ?? "");
  const [weather, setWeather] = useState(entry?.weather ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setDate(toDateInput(entry.date));
    setTitle(entry.title ?? "");
    setBody(entry.body);
    setMood(entry.mood ?? "");
    setWeather(entry.weather ?? "");
  }, [entry]);

  const handleSave = async (): Promise<void> => {
    if (!date || !body.trim()) return;
    setSaving(true);
    try {
      if (entry) {
        await tripsApi.updateJournalEntry(tripId, entry.id, {
          date: fromDateInput(date),
          title: title.trim() || null,
          body: body.trim(),
          mood: mood.trim() || null,
          weather: weather.trim() || null,
        });
      } else {
        await tripsApi.createJournalEntry(tripId, {
          date: fromDateInput(date),
          title: title.trim() || undefined,
          body: body.trim(),
          mood: mood.trim() || undefined,
          weather: weather.trim() || undefined,
        });
      }
      onSaved();
    } catch {
      addToast("error", entry ? t("trips:toasts.updateError") : t("trips:toasts.createError"));
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
            {entry ? t("trips:journalModal.editTitle") : t("trips:journalModal.createTitle")}
          </h2>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <Field label={t("trips:journalModal.dateLabel")}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            />
          </Field>
          <Field label={t("trips:journalModal.titleLabel")}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("trips:journalModal.titlePlaceholder")}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            />
          </Field>
          <Field label={t("trips:journalModal.bodyLabel")}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("trips:journalModal.bodyPlaceholder")}
              rows={8}
              className="w-full rounded-lg px-3 py-2 text-sm resize-vertical"
              style={inputStyle}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("trips:journalModal.moodLabel")}>
              <input
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="🙂 / 🌟 / 😴"
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
            <Field label={t("trips:journalModal.weatherLabel")}>
              <input
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
                placeholder="☀ 24°C"
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
            </Field>
          </div>
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
            {t("trips:journalModal.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!date || !body.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-(--accent) text-(--bg-base) disabled:opacity-50"
          >
            {saving ? "…" : t("trips:journalModal.save")}
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
