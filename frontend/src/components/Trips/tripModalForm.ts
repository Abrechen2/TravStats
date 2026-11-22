import { useState, useEffect, useRef, useCallback } from "react";
import type { Trip, TripCategory } from "../../types";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { useTripEntrySuggestions } from "../../hooks/useTripEntrySuggestions";
import { tripEntrySpan } from "../../lib/tripEntrySpan";
import { dayInput } from "../../lib/api/timeInput";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import type { ModalTab } from "./tripModalParts";

// Convert ISO date string ↔ <input type="date"> "YYYY-MM-DD" form. Local
// timezone is fine here — trip dates are calendar dates, not instants.
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Sent as the bare day, `YYYY-MM-DD` (ADR 0002) — a trip's first and last
// day are dates, not instants.
function fromDateInput(value: string): string | null {
  return dayInput(value);
}

interface TripFormValues {
  name: string;
  description: string;
  color: string | null;
  category: TripCategory | "";
  startDate: string;
  endDate: string;
  originLabel: string;
  destinationLabel: string;
  tags: string[];
  companions: string[];
  notes: string;
  removeCover: boolean;
}

/** Update the trip, or create it when there is none yet. */
function persistTrip(trip: Trip | null, v: TripFormValues): Promise<Trip> {
  if (trip) {
    return tripsApi.update(trip.id, {
      name: v.name.trim(),
      description: v.description.trim() || null,
      color: v.color ?? trip.color,
      category: v.category === "" ? null : v.category,
      startDate: fromDateInput(v.startDate),
      endDate: fromDateInput(v.endDate),
      originLabel: v.originLabel.trim() || null,
      destinationLabel: v.destinationLabel.trim() || null,
      tags: v.tags,
      companions: v.companions,
      notes: v.notes.trim() || null,
      ...(v.removeCover ? { coverImageUrl: null } : {}),
    });
  }
  return tripsApi.create({
    name: v.name.trim(),
    description: v.description.trim() || undefined,
    color: v.color ?? undefined,
    category: v.category === "" ? undefined : v.category,
    startDate: fromDateInput(v.startDate) ?? undefined,
    endDate: fromDateInput(v.endDate) ?? undefined,
    originLabel: v.originLabel.trim() || undefined,
    destinationLabel: v.destinationLabel.trim() || undefined,
    tags: v.tags,
    companions: v.companions,
    notes: v.notes.trim() || undefined,
  });
}

/**
 * Cover is upload-only. The chosen file is buffered and uploaded on save,
 * so it works even while creating a brand-new trip (before an id exists).
 * `coverUrl` holds the existing server cover; `coverFile`/`coverPreview`
 * hold a pending local pick; `removeCover` marks an explicit clear.
 */
function useTripCover(trip: Trip | null) {
  const [coverUrl, setCoverUrl] = useState(trip?.coverImageUrl ?? "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
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

  const resetFromTrip = useCallback((next: Trip): void => {
    setCoverUrl(next.coverImageUrl ?? "");
    setCoverFile(null);
    setCoverPreview(null);
    setRemoveCover(false);
  }, []);

  return {
    coverUrl,
    coverFile,
    coverPreview,
    removeCover,
    uploadingCover,
    setUploadingCover,
    coverInputRef,
    handlePickCover,
    handleRemoveCover,
    resetFromTrip,
  };
}

export type TripModalForm = ReturnType<typeof useTripModalForm>;

/** All field state, the cover handling and the save of the trip modal. */
export function useTripModalForm(
  trip: Trip | null,
  onSaved: () => void,
  /** The gap calendar's days: a new trip opens with them as start and end. */
  initialDates?: { from: string; to: string }
) {
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [tab, setTab] = useState<ModalTab>("general");
  const [name, setName] = useState(trip?.name ?? "");
  const [description, setDescription] = useState(trip?.description ?? "");
  // A new trip starts with the account's chosen colour (forgejo#321). Without
  // one the colour is automatic: null until a swatch is picked, and then not
  // sent, so the server gives the next palette colour like every other path.
  const preferredColor = useSuggestionSwitchesStore((s) => s.tripDefaultColor);
  const [color, setColor] = useState<string | null>(trip?.color ?? preferredColor);
  const [category, setCategory] = useState<TripCategory | "">(trip?.category ?? "");
  const [startDate, setStartDate] = useState(
    trip ? toDateInput(trip.startDate ?? null) : (initialDates?.from ?? "")
  );
  const [endDate, setEndDate] = useState(
    trip ? toDateInput(trip.endDate ?? null) : (initialDates?.to ?? "")
  );
  const [originLabel, setOriginLabel] = useState(trip?.originLabel ?? "");
  const [destinationLabel, setDestinationLabel] = useState(trip?.destinationLabel ?? "");
  const [tags, setTags] = useState<string[]>(trip?.tags ?? []);
  const [companions, setCompanions] = useState<string[]>(trip?.companions ?? []);
  const [notes, setNotes] = useState(trip?.notes ?? "");
  const cover = useTripCover(trip);
  const { coverUrl, coverFile, coverPreview, removeCover, uploadingCover, setUploadingCover } =
    cover;
  const { coverInputRef, handlePickCover, handleRemoveCover, resetFromTrip } = cover;
  const [saving, setSaving] = useState(false);
  // The server refuses a name of only whitespace (schemas/trip.ts). Said at
  // the field once a save was tried, instead of a save button greyed out
  // with no word of why.
  const [saveTried, setSaveTried] = useState(false);
  const nameMissing = !name.trim();
  const showNameMissing = saveTried && nameMissing;
  // Offered under the two place labels, never written into them: the labels
  // stay the user's free text.
  const placeSuggestions = useTripEntrySuggestions(trip?.id ?? null);
  // Read from the entries the trip detail already carries; a trip from a list
  // endpoint has none, and then there is simply nothing to offer.
  const entrySpan = trip ? tripEntrySpan(trip) : null;
  const offerEntrySpan =
    entrySpan !== null && (entrySpan.start !== startDate || entrySpan.end !== endDate);

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
    setTags(trip.tags);
    setCompanions(trip.companions);
    setNotes(trip.notes ?? "");
    resetFromTrip(trip);
  }, [trip, resetFromTrip]);

  // Both inputs are `type="date"`, so their values are YYYY-MM-DD and compare
  // correctly as strings. The audit saved 10.08. → 01.08. through this very
  // form and got a 200 (SRV-TRIP-DATE-001); the server refuses that now, and
  // this says WHICH field is wrong instead of raising a generic save toast.
  const datesOutOfOrder = Boolean(startDate && endDate && endDate < startDate);

  const handleSave = async (): Promise<void> => {
    setSaveTried(true);
    if (nameMissing) {
      // The name lives on the first tab; a save tried from another one must
      // still show the reader the field that stopped it.
      setTab("general");
      return;
    }
    if (datesOutOfOrder) return;
    setSaving(true);
    try {
      // The cover image is never sent as a field here — it's uploaded
      // separately below. We only touch coverImageUrl to clear an existing
      // cover when the user explicitly removed it.
      const savedTrip = await persistTrip(trip, {
        name,
        description,
        color,
        category,
        startDate,
        endDate,
        originLabel,
        destinationLabel,
        tags,
        companions,
        notes,
        removeCover,
      });

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
    } catch (err: unknown) {
      const fallback = trip ? "trips:toasts.updateError" : "trips:toasts.createError";
      addToast("error", saveErrorMessage(err, t, fallback));
    } finally {
      setSaving(false);
    }
  };

  return {
    tab,
    setTab,
    name,
    setName,
    description,
    setDescription,
    color,
    setColor,
    category,
    setCategory,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    originLabel,
    setOriginLabel,
    destinationLabel,
    setDestinationLabel,
    tags,
    setTags,
    companions,
    setCompanions,
    notes,
    setNotes,
    coverUrl,
    coverFile,
    coverPreview,
    saving,
    showNameMissing,
    uploadingCover,
    coverInputRef,
    placeSuggestions,
    entrySpan,
    offerEntrySpan,
    handlePickCover,
    handleRemoveCover,
    datesOutOfOrder,
    handleSave,
  };
}
