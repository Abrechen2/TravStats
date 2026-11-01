import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import type { TourRoute } from "../../types/tour";
import TagChips from "../common/TagChips";
import TagInput from "../TagInput";

/**
 * A roadtrip's or tour's tags (forgejo#405): chips while reading, a tag input
 * with an explicit Save while editing. One request per save; a failure keeps
 * what was typed and says why (never a silent revert), and the stored tags
 * are only replaced by the server's own answer.
 */
export default function RouteTagsEditor({
  route,
  tripId,
  onSaved,
}: {
  route: Pick<TourRoute, "id" | "tags">;
  /** The trip the section is reached through, or undefined for a standalone one. */
  tripId: string | undefined;
  onSaved: (route: TourRoute) => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const stored = route.tags ?? [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(stored);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setErrorKey(null);
    try {
      onSaved(await toursApi.update(tripId, route.id, { tags: draft }));
      setEditing(false);
    } catch (err: unknown) {
      logger.error({ err }, "RouteTagsEditor: saving the tags failed");
      setErrorKey(saveErrorKey(err, "roadtrips:tags.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {stored.length > 0 && <TagChips tags={stored} />}
        <button
          type="button"
          className="t-caption underline pointer-coarse:min-h-(--ts-size-touch-min)"
          onClick={() => {
            setDraft(stored);
            setEditing(true);
          }}
        >
          {stored.length > 0 ? t("roadtrips:tags.edit") : t("roadtrips:tags.add")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" style={{ maxWidth: 520 }}>
      <TagInput
        ariaLabel={t("roadtrips:tags.label")}
        className="w-full rounded-md border border-(--color-border) bg-transparent px-3 py-2 text-sm"
        value={draft}
        onChange={setDraft}
      />
      {errorKey !== null && (
        <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
          {t(errorKey)}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary disabled:opacity-50"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? t("common:buttons.saving") : t("common:buttons.save")}
        </button>
        <button
          type="button"
          className="underline"
          disabled={saving}
          onClick={() => setEditing(false)}
        >
          {t("common:buttons.cancel")}
        </button>
      </div>
    </div>
  );
}
