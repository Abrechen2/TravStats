import type { CSSProperties, ReactNode } from "react";
import type { Trip, TripCategory } from "../../types";
import { TRIP_COLORS as PALETTE } from "../../lib/tripColors";
import { useTranslation } from "../../hooks/useTranslation";
import CompanionPicker from "../CompanionPicker";
import TagInput from "../TagInput";
import SuggestionChips from "../common/SuggestionChips";
import { formatDate } from "../../lib/displayFormat";
import type { TripModalForm } from "./tripModalForm";
import InlineError from "../ui/InlineError";

const CATEGORIES: TripCategory[] = ["vacation", "business", "weekend", "family", "other"];

const CATEGORY_ICON: Record<TripCategory, string> = {
  vacation: "🏖",
  business: "💼",
  weekend: "🎒",
  family: "👨‍👩‍👧",
  other: "🗺",
};

export type ModalTab = "general" | "people" | "appearance" | "notes";

export const TABS: ReadonlyArray<{ id: ModalTab; icon: string }> = [
  { id: "general", icon: "📋" },
  { id: "people", icon: "👥" },
  { id: "appearance", icon: "🎨" },
  { id: "notes", icon: "📝" },
];

export const inputStyle: CSSProperties = {
  background: "var(--bg-input, var(--bg-base))",
  border: "1px solid var(--color-border)",
  color: "var(--text-primary)",
};

export interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, hint, children }: FieldProps): JSX.Element {
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

function NameCategoryFields({ f }: { f: TripModalForm }): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  return (
    <>
      <Field label={t("trips:modal.nameLabel")}>
        <input
          value={f.name}
          onChange={(e) => f.setName(e.target.value)}
          placeholder={t("trips:modal.namePlaceholder")}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
          aria-invalid={f.showNameMissing || undefined}
          aria-describedby={f.showNameMissing ? "trip-name-error" : undefined}
        />
        {f.showNameMissing && (
          <InlineError id="trip-name-error" className="mt-1">
            {t("trips:modal.nameRequired")}
          </InlineError>
        )}
      </Field>

      {/* #status-from-dates: trip status now derives from linked
          segment dates (deriveTripStatus) — there is no manual
          control here, and no "cancelled" concept for trips. */}
      <Field label={t("trips:modal.categoryLabel")}>
        <select
          value={f.category}
          onChange={(e) => f.setCategory(e.target.value as TripCategory | "")}
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
    </>
  );
}

function DateFields({ f }: { f: TripModalForm }): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const { entrySpan } = f;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("trips:modal.startDateLabel")}>
          <input
            type="date"
            value={f.startDate}
            onChange={(e) => f.setStartDate(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
        </Field>
        <Field label={t("trips:modal.endDateLabel")}>
          <input
            type="date"
            value={f.endDate}
            onChange={(e) => f.setEndDate(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
            aria-invalid={f.datesOutOfOrder}
          />
          {f.datesOutOfOrder && (
            <InlineError className="mt-1">{t("trips:modal.endBeforeStart")}</InlineError>
          )}
        </Field>
      </div>
      {f.offerEntrySpan && entrySpan && (
        <button
          type="button"
          onClick={() => {
            f.setStartDate(entrySpan.start);
            f.setEndDate(entrySpan.end);
          }}
          className="-mt-2 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-(--text-muted) hover:border-(--accent) hover:text-(--accent)"
        >
          {t("trips:modal.useEntrySpan", {
            start: formatDate(entrySpan.start, { timeZone: "UTC" }),
            end: formatDate(entrySpan.end, { timeZone: "UTC" }),
          })}
        </button>
      )}
    </>
  );
}

function PlaceFields({ f }: { f: TripModalForm }): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("trips:modal.originLabel")}>
          <input
            value={f.originLabel}
            onChange={(e) => f.setOriginLabel(e.target.value)}
            placeholder="München"
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
          <SuggestionChips
            value={f.originLabel}
            suggestions={f.placeSuggestions.origins}
            onPick={f.setOriginLabel}
            fieldLabel={t("trips:modal.originLabel")}
          />
        </Field>
        <Field label={t("trips:modal.destinationLabel")}>
          <input
            value={f.destinationLabel}
            onChange={(e) => f.setDestinationLabel(e.target.value)}
            placeholder="Tokyo, Japan"
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
          <SuggestionChips
            value={f.destinationLabel}
            suggestions={f.placeSuggestions.destinations}
            onPick={f.setDestinationLabel}
            fieldLabel={t("trips:modal.destinationLabel")}
          />
        </Field>
      </div>
    </>
  );
}

function DescriptionField({ f }: { f: TripModalForm }): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  return (
    <>
      <Field label={t("trips:modal.descLabel")} hint={t("trips:modal.descHint")}>
        <textarea
          value={f.description}
          onChange={(e) => f.setDescription(e.target.value)}
          placeholder={t("trips:modal.descPlaceholder")}
          rows={2}
          className="w-full rounded-lg px-3 py-2 text-sm resize-none"
          style={inputStyle}
        />
      </Field>
    </>
  );
}

export function GeneralTab({ f }: { f: TripModalForm }): JSX.Element {
  return (
    <>
      <NameCategoryFields f={f} />
      <DateFields f={f} />
      <PlaceFields f={f} />
      <DescriptionField f={f} />
    </>
  );
}

export function PeopleTab({ f }: { f: TripModalForm }): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  return (
    <>
      <Field label={t("trips:modal.companionsLabel")}>
        <CompanionPicker value={f.companions} onChange={f.setCompanions} />
      </Field>

      <Field label={t("trips:modal.tagsLabel")}>
        <TagInput
          value={f.tags}
          onChange={f.setTags}
          ariaLabel={t("trips:modal.tagsLabel")}
          placeholder="kultur, food, fotos"
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
          accent={f.color ?? PALETTE[0]}
        />
      </Field>
    </>
  );
}

function CoverField({ f, trip }: { f: TripModalForm; trip: Trip | null }): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const hasCover = Boolean(f.coverPreview || f.coverUrl);
  return (
    <Field label={t("trips:modal.coverLabel")}>
      <input
        ref={f.coverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={f.handlePickCover}
      />
      <CoverPreview
        url={f.coverPreview ?? f.coverUrl}
        accent={f.color ?? PALETTE[0]}
        title={f.name || "—"}
        onClick={() => f.coverInputRef.current?.click()}
      />
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={() => f.coverInputRef.current?.click()}
          disabled={f.uploadingCover}
          className="px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          {f.uploadingCover
            ? "…"
            : hasCover
              ? t("trips:modal.coverUploadReplace")
              : t("trips:modal.coverUploadButton")}
        </button>
        {hasCover && (
          <button
            type="button"
            onClick={f.handleRemoveCover}
            disabled={f.uploadingCover}
            className="px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
          >
            {t("trips:modal.coverRemove")}
          </button>
        )}
      </div>
      <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
        {f.coverFile && !trip ? t("trips:modal.coverPending") : t("trips:modal.coverUploadReady")}
      </p>
    </Field>
  );
}

export function AppearanceTab({ f, trip }: { f: TripModalForm; trip: Trip | null }): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  return (
    <>
      <CoverField f={f} trip={trip} />
      <Field label={t("trips:modal.colorLabel")}>
        <div className="flex gap-2 flex-wrap">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => f.setColor(c)}
              aria-label={c}
              aria-pressed={f.color === c}
              type="button"
              className="w-7 h-7 rounded-full transition-transform hover:scale-110"
              style={{
                background: c,
                outline: f.color === c ? `2px solid ${c}` : "none",
                outlineOffset: "2px",
              }}
            />
          ))}
        </div>
      </Field>
    </>
  );
}

export function NotesTab({ f }: { f: TripModalForm }): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  return (
    <Field label={t("trips:modal.notesLabel")} hint={t("trips:modal.notesMarkdownHint")}>
      <textarea
        value={f.notes}
        onChange={(e) => f.setNotes(e.target.value)}
        placeholder={t("trips:modal.notesPlaceholder")}
        rows={14}
        className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
        style={inputStyle}
      />
    </Field>
  );
}
