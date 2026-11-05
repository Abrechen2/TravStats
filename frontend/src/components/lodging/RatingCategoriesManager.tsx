import { useState, type JSX } from "react";
import { isAxiosError } from "axios";

import { useTranslation } from "../../hooks/useTranslation";
import { useRatingCategories } from "../../hooks/useRatingCategories";
import { useRatingCategoriesStore } from "../../store/lodgingRatingCategoriesStore";
import { logger } from "../../lib/logger";
import { MAX_CUSTOM_CATEGORY_NAME } from "../../shared/ratingCategories";

interface RatingCategoriesManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Where the account's rating categories are managed: switch built-in ones on
 * and off, add, rename and delete its own. It lives beside the pickers it
 * governs because the lodging settings page no longer exists (the geocoder, its
 * only content, moved to Administration) and the settings registry is pinned to
 * the designer's data.
 *
 * Nothing here rewrites a stay: an overall is the mean of the values a stay
 * HAS, so switching off or deleting changes only what is OFFERED. A failed call
 * says so, with the reason the server gave (a duplicate name, the limit).
 */
export function RatingCategoriesManager({
  open,
  onOpenChange,
}: RatingCategoriesManagerProps): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  const { view, labelOf } = useRatingCategories();
  const store = useRatingCategoriesStore.getState;
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>): Promise<boolean> => {
    setError(null);
    try {
      await action();
      return true;
    } catch (err: unknown) {
      logger.error("RatingCategoriesManager: the change was refused", err);
      setError(
        isAxiosError(err) && err.response?.status === 409
          ? t("lodging:stayEditor.ratingCategoryDuplicate")
          : isAxiosError(err) && err.response?.status === 400
            ? t("lodging:stayEditor.ratingCategoryTooMany")
            : t("lodging:stayEditor.ratingCategoryFailed")
      );
      return false;
    }
  };

  const toggle = (key: string): Promise<boolean> =>
    run(() =>
      store().setActive(
        view.active.includes(key) ? view.active.filter((k) => k !== key) : [...view.active, key]
      )
    );

  if (!open) {
    return (
      <button
        type="button"
        data-testid="rating-categories-manage"
        onClick={() => onOpenChange(true)}
        className="self-start text-xs text-[var(--accent)] hover:underline"
      >
        {t("lodging:stayEditor.ratingCategoriesManage")}
      </button>
    );
  }

  const own = view.custom.filter((c) => !c.deleted);
  return (
    <div
      data-testid="rating-categories-panel"
      className="flex flex-col gap-3 rounded-md border border-[var(--border)] p-3"
    >
      <span className="text-sm font-medium">{t("lodging:stayEditor.ratingCategoriesTitle")}</span>
      <p className="text-xs text-[var(--text-muted)]">
        {t("lodging:stayEditor.ratingCategoriesIntro")}
      </p>
      <div className="flex flex-wrap gap-2">
        {view.builtIn.map((key) => (
          <label key={key} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              data-testid={`rating-category-toggle-${key}`}
              checked={view.active.includes(key)}
              onChange={() => void toggle(key)}
            />
            {labelOf(key)}
          </label>
        ))}
      </div>

      <span className="text-xs font-medium text-[var(--text-muted)]">
        {t("lodging:stayEditor.ratingCategoriesOwn")}
      </span>
      <ul className="flex flex-col gap-1">
        {own.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-sm">
            {renaming?.id === c.id ? (
              <>
                <input
                  aria-label={t("lodging:stayEditor.ratingCategoryRename")}
                  value={renaming.name}
                  maxLength={MAX_CUSTOM_CATEGORY_NAME}
                  onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                  className="rounded border border-[var(--border)] px-2 py-0.5"
                />
                <button
                  type="button"
                  onClick={() =>
                    void run(() => store().rename(c.id, renaming.name)).then(
                      (ok) => ok && setRenaming(null)
                    )
                  }
                >
                  {t("lodging:stayEditor.ratingCategorySave")}
                </button>
                <button type="button" onClick={() => setRenaming(null)}>
                  {t("lodging:stayEditor.ratingCategoryCancel")}
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">{c.name}</span>
                <button type="button" onClick={() => setRenaming({ id: c.id, name: c.name })}>
                  {t("lodging:stayEditor.ratingCategoryRename")}
                </button>
                <button
                  type="button"
                  data-testid={`rating-category-delete-${c.id}`}
                  title={t("lodging:stayEditor.ratingCategoryDeleteHint")}
                  onClick={() => void run(() => store().remove(c.id))}
                >
                  {t("lodging:stayEditor.ratingCategoryDelete")}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim() === "") return;
          void run(() => store().add(newName.trim())).then((ok) => ok && setNewName(""));
        }}
      >
        <input
          data-testid="rating-category-new-name"
          aria-label={t("lodging:stayEditor.ratingCategoryName")}
          placeholder={t("lodging:stayEditor.ratingCategoryName")}
          value={newName}
          maxLength={MAX_CUSTOM_CATEGORY_NAME}
          onChange={(e) => setNewName(e.target.value)}
          className="rounded border border-[var(--border)] px-2 py-0.5 text-sm"
        />
        <button type="submit" data-testid="rating-category-add">
          {t("lodging:stayEditor.ratingCategoryAdd")}
        </button>
      </form>
      {error !== null && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="self-start text-xs text-[var(--accent)] hover:underline"
      >
        {t("lodging:stayEditor.ratingCategoriesDone")}
      </button>
    </div>
  );
}
