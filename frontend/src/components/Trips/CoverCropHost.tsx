import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { tripsApi } from "../../lib/api/trips";
import type { CoverCrop } from "../../lib/coverCrop";
import { useCoverCropStore } from "../../store/coverCropStore";
import CoverCropEditor from "./CoverCropEditor";

/**
 * The one place the crop editor opens (mounted once in the trip detail page
 * and the trips list): any flow that sets or re-frames a cover raises a
 * request in `coverCropStore`. A failed save keeps the editor open with the
 * reason, so a crop is never silently lost.
 */
export default function CoverCropHost({
  onSaved,
}: {
  /** The trip list or page behind the editor reloads, whichever flow raised the request. */
  onSaved?: () => void;
}): JSX.Element | null {
  const { t } = useTranslation("immich");
  const request = useCoverCropStore((s) => s.request);
  const close = useCoverCropStore((s) => s.close);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!request) return null;

  const finish = (): void => {
    const done = request.onDone;
    setError(null);
    close();
    if (done) done();
    else onSaved?.();
  };
  const save = async (crop: CoverCrop | null): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await tripsApi.update(request.tripId, {
        coverCrop: crop,
        coverCropFor: request.coverImageUrl,
      });
      finish();
    } catch (err) {
      logger.error("CoverCropHost: saving the crop failed", err);
      setError(t("cover.crop.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CoverCropEditor
      key={`${request.tripId}:${request.coverImageUrl}`}
      url={request.coverImageUrl}
      initialCrop={request.initialCrop}
      saving={saving}
      error={error}
      onSave={(crop) => void save(crop)}
      onCancel={finish}
    />
  );
}
