import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { usePlaceCategories } from "../../hooks/usePlaceCategories";
import {
  createPlaceCategory,
  deletePlaceCategory,
  type CustomPlaceCategory,
} from "../../lib/api/placeCategories";
import { logger } from "../../lib/logger";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { placeCategoryIcon } from "../../lib/placeCategoryDisplay";
import { PLACE_CATEGORY_ICON_CHOICES, PLACE_CATEGORY_NAME_MAX } from "../../shared/placeCategories";
import { useToastStore } from "../../store/toastStore";

interface Props {
  /** Called with the new category's name so a form can select it at once. */
  onCreated?: (name: string) => void;
  /** Called with the deleted name, so a form showing it can fall back. */
  onDeleted?: (name: string) => void;
}

const FIELD =
  "rounded-md border border-[var(--color-border)] bg-[var(--bg-base)] px-2 py-1 text-sm text-[var(--text-primary)]";

/**
 * Create and delete the user's own place categories. A delete folds the
 * places that carried the category to "other" on the server; this component
 * says how many moved, so the fallback is never silent.
 */
export default function PlaceCategoryManager({ onCreated, onDeleted }: Props): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const { customs, reload } = usePlaceCategories();
  const addToast = useToastStore((s) => s.addToast);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(PLACE_CATEGORY_ICON_CHOICES[0]);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  // The write succeeded; only the refreshed list is missing. Say so rather than
  // report a failed save or show a list that silently lacks the change.
  const refresh = async (): Promise<void> => {
    try {
      await reload();
    } catch (err: unknown) {
      logger.error("PlaceCategoryManager: reload failed", err);
      setError(t("places:customCategories.errors.stale"));
    }
  };

  const create = async (): Promise<void> => {
    setError(null);
    try {
      const made = await createPlaceCategory({ name: name.trim(), icon });
      setName("");
      onCreated?.(made.name);
      await refresh();
    } catch (err: unknown) {
      logger.error("PlaceCategoryManager: create failed", err);
      setError(
        saveErrorMessage(err, t, "places:customCategories.errors.generic", {
          PLACE_CATEGORY_BUILT_IN: "places:customCategories.errors.builtIn",
          PLACE_CATEGORY_EXISTS: "places:customCategories.errors.exists",
          PLACE_CATEGORY_LIMIT: "places:customCategories.errors.limit",
        })
      );
    }
  };

  const remove = async (category: CustomPlaceCategory): Promise<void> => {
    setAsking(null);
    setError(null);
    try {
      const { movedPlaces } = await deletePlaceCategory(category.id);
      await refresh();
      onDeleted?.(category.name);
      addToast("success", t("places:customCategories.deleted", { count: movedPlaces }));
    } catch (err: unknown) {
      logger.error("PlaceCategoryManager: delete failed", err);
      setError(t("places:customCategories.errors.deleteFailed"));
    }
  };

  return (
    <div data-testid="place-category-manager" className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-[var(--text-muted)]">{t("places:customCategories.manageHint")}</p>
      {customs.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{t("places:customCategories.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {customs.map((c) => (
            <li
              key={c.id}
              data-testid={`place-category-${c.id}`}
              className="flex items-center gap-2"
            >
              <span aria-hidden>{placeCategoryIcon(c.name, customs)}</span>
              <span className="flex-1">{c.name}</span>
              {asking === c.id ? (
                <>
                  <span className="text-xs text-[var(--text-muted)]">
                    {t("places:customCategories.deleteSure")}
                  </span>
                  <button
                    type="button"
                    data-testid={`place-category-delete-confirm-${c.id}`}
                    className="text-xs text-[var(--ts-bad)] hover:underline"
                    onClick={() => void remove(c)}
                  >
                    {t("places:customCategories.deleteYes")}
                  </button>
                  <button
                    type="button"
                    className="text-xs hover:underline"
                    onClick={() => setAsking(null)}
                  >
                    {t("places:customCategories.cancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid={`place-category-delete-${c.id}`}
                  className="text-xs text-[var(--ts-bad)] hover:underline"
                  onClick={() => setAsking(c.id)}
                >
                  {t("places:customCategories.delete")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("places:customCategories.iconLabel")}
          className={FIELD}
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
        >
          {PLACE_CATEGORY_ICON_CHOICES.map((glyph) => (
            <option key={glyph} value={glyph}>
              {glyph}
            </option>
          ))}
        </select>
        <input
          data-testid="place-category-name"
          className={`${FIELD} min-w-0 flex-1`}
          value={name}
          maxLength={PLACE_CATEGORY_NAME_MAX}
          placeholder={t("places:customCategories.namePlaceholder")}
          aria-label={t("places:customCategories.manage")}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          data-testid="place-category-add"
          className="rounded-md border border-[var(--color-border)] px-3 py-1 text-sm"
          disabled={name.trim() === ""}
          onClick={() => void create()}
        >
          {t("places:customCategories.add")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--ts-bad)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
