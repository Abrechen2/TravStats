import { useState } from "react";
import type { JSX } from "react";

import { updateLodging } from "../../lib/api/lodging";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import type { Lodging } from "../../types/lodging";

/** The codes the server writes to `lodgings.location_check`; anything else is ignored. */
const SHOWN_CODES = [
  "name_only",
  "contradicted",
  "provider_unavailable",
  "no_result",
  "pin_country_mismatch",
] as const;

interface Props {
  lodging: Pick<Lodging, "id" | "name" | "lat" | "lon" | "locationCheck">;
  onSetLocation: () => void;
  onReviewed: (updated: Lodging) => void;
}

/**
 * Says WHY a house's position needs a look instead of leaving a wrong pin or an
 * empty map unexplained (GitHub #401). A geocoder answer that contradicted the
 * record was not written; a pin that contradicts the country was only flagged.
 * Either way the user decides: set the point, or confirm the one that is there.
 */
export function LodgingLocationCheckNotice({
  lodging,
  onSetLocation,
  onReviewed,
}: Props): JSX.Element | null {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [saving, setSaving] = useState(false);
  const code = lodging.locationCheck;
  if (!code || !(SHOWN_CODES as readonly string[]).includes(code)) return null;
  const pinned = lodging.lat !== null && lodging.lon !== null;

  const confirm = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await updateLodging(lodging.id, { locationCheck: "reviewed" });
      addToast("success", t("lodging:locationCheck.confirmed"));
      onReviewed(updated);
    } catch (err) {
      logger.error("LodgingLocationCheckNotice: could not mark the position as checked", err);
      addToast("error", t("lodging:locationCheck.confirmFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="lodging-location-check"
      className="flex flex-col gap-2 rounded-md border border-[var(--warning)]/50 p-3 text-sm"
    >
      <strong>{t("lodging:locationCheck.title")}</strong>
      <p>{t(`lodging:locationCheck.${code}`, { name: lodging.name })}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="underline" onClick={onSetLocation}>
          {t("lodging:locationCheck.setLocation")}
        </button>
        {pinned && (
          <button type="button" className="underline" disabled={saving} onClick={confirm}>
            {t("lodging:locationCheck.confirm")}
          </button>
        )}
      </div>
    </div>
  );
}
