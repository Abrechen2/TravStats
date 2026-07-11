import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { createLodging, updateLodging } from "../../lib/api/lodging";
import type { Lodging, LodgingChain, LodgingInput, LodgingType } from "../../types/lodging";
import { logger } from "../../lib/logger";
import { ChainPicker } from "./ChainPicker";

const LODGING_TYPES: LodgingType[] = ["hotel", "campsite", "guesthouse", "apartment", "hostel"];

interface LodgingFormModalProps {
  mode: "create" | "edit";
  lodging?: Lodging | null;
  onClose: () => void;
  onSaved: (saved: Lodging) => void | Promise<void>;
}

/**
 * Create/edit form for the `Lodging` place itself (name, type, address,
 * stars, amenities, notes, chain). A lodging can exist independently of any
 * chain ("— unabhängig" in the mockup) — clearing the `ChainPicker` sends
 * `chainId: null`.
 */
export function LodgingFormModal({ mode, lodging, onClose, onSaved }: LodgingFormModalProps): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  const [type, setType] = useState<LodgingType>(lodging?.type ?? "hotel");
  const [chain, setChain] = useState<LodgingChain | null>(lodging?.chain ?? null);
  const [name, setName] = useState<string>(lodging?.name ?? "");
  const [address, setAddress] = useState<string>(lodging?.address ?? "");
  const [city, setCity] = useState<string>(lodging?.city ?? "");
  const [country, setCountry] = useState<string>(lodging?.country ?? "");
  const [stars, setStars] = useState<string>(lodging?.stars?.toString() ?? "");
  const [amenitiesInput, setAmenitiesInput] = useState<string>((lodging?.amenities ?? []).join(", "));
  const [notes, setNotes] = useState<string>(lodging?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (): Promise<void> => {
    if (mode === "edit" && !lodging) {
      // Defensive only — callers always pass `lodging` in edit mode.
      setError(t("lodging:form.saveError"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: LodgingInput = {
        type,
        name: name.trim(),
        chainId: chain?.id ?? null,
        // `null` (not `undefined`) so an emptied field actually clears the
        // stored value instead of being dropped by JSON.stringify and read
        // back as "unchanged" (finding 4).
        address: address.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
        stars: stars.trim() ? Number.parseInt(stars, 10) : null,
        amenities: amenitiesInput
          .split(",")
          .map((a) => a.trim())
          .filter((a) => a.length > 0),
        notes: notes.trim() || null,
      };
      let saved: Lodging;
      if (mode === "create") {
        saved = await createLodging(input);
      } else if (lodging) {
        saved = await updateLodging(lodging.id, input);
      } else {
        // Unreachable — the guard above already returned for this case —
        // but this keeps `lodging.id` above type-checked without an assertion.
        return;
      }
      await onSaved(saved);
    } catch (err: unknown) {
      logger.error("LodgingFormModal: save failed", err);
      setError(t("lodging:form.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const title = mode === "create" ? t("lodging:form.createTitle") : t("lodging:form.editTitle");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-lg border border-[var(--color-border)] bg-[var(--bg-elevated)] p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            {t("lodging:field.name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("lodging:field.type")}
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LodgingType)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {LODGING_TYPES.map((lt) => (
                <option key={lt} value={lt}>
                  {t(`lodging:type.${lt}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            {t("lodging:field.chain")}
            <ChainPicker value={chain} onChange={setChain} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("lodging:field.stars")}
            <input
              type="number"
              min={1}
              max={5}
              value={stars}
              onChange={(e) => setStars(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            {t("lodging:field.address")}
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("lodging:field.city")}
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("lodging:field.country")}
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            {t("lodging:field.amenities")}
            <input
              value={amenitiesInput}
              onChange={(e) => setAmenitiesInput(e.target.value)}
              placeholder={t("lodging:field.amenitiesPlaceholder")}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] sm:col-span-2">
            {t("lodging:field.notes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || name.trim().length === 0}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
          >
            {saving ? t("common:buttons.saving") : t("common:buttons.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
