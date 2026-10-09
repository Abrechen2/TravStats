import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { PLACE_CATEGORY_ICONS } from "../../shared/placeCategories";
import type { Place } from "../../types/place";

const COARSE_BOX =
  "pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:min-w-(--ts-size-touch-min)";

/** A place that was created from this list but that the list did not take. */
export interface UnassignedPlace {
  place: Place;
  /** The translation key of why it failed. */
  reasonKey: string;
  /** A retry is on its way — the button waits for it. */
  retrying: boolean;
}

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  /** Own places matching the query that are not in the list yet. */
  candidates: readonly Place[];
  onAdd: (placeId: string) => void;
  /** Create a new place named after the query, then file it here (forgejo#230). */
  onCreate: () => void;
  unassigned: readonly UnassignedPlace[];
  onRetry: (placeId: string) => void;
  onDismiss: (placeId: string) => void;
}

/**
 * "Ort hinzufügen" on a list: search the places the user already has — and,
 * when the search finds nothing, create the place right here (forgejo#230).
 *
 * Before, a miss said "Lege ihn zuerst unter „Orte“ an": leave the list, create
 * the place, come back, search again, add it. Now the miss offers "Ort anlegen
 * und hinzufügen" with the typed text as the name; the place form opens over
 * the list and, once saved, the place is filed here exactly once.
 *
 * If only the filing fails, the place is still saved — it is in the logbook —
 * and a row here says so and offers to file it again, for that place alone.
 */
export function PlaceListAddPanel({
  query,
  onQueryChange,
  candidates,
  onAdd,
  onCreate,
  unassigned,
  onRetry,
  onDismiss,
}: Props): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const searching = query.trim().length > 0;

  return (
    <div
      className="mb-6 rounded-xl p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <label
        htmlFor="place-list-add"
        className="mb-2 block text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {t("places:lists.addPlace")}
      </label>
      <input
        id="place-list-add"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={t("places:lists.addPlacePlaceholder")}
        className={`w-full rounded-lg px-3 py-2 text-sm ${COARSE_BOX}`}
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--color-border)",
          color: "var(--text-primary)",
        }}
      />
      {searching && (
        <ul className="mt-2" style={{ listStyle: "none", padding: 0 }}>
          {candidates.length === 0 ? (
            <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span style={{ color: "var(--text-muted)" }}>{t("places:lists.addNoMatches")}</span>
              <button
                type="button"
                onClick={onCreate}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${COARSE_BOX}`}
                style={{ border: "1px solid var(--domain-poi)", color: "var(--domain-poi)" }}
              >
                {t("places:lists.createAndAdd", { name: query.trim() })}
              </button>
            </li>
          ) : (
            candidates.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onAdd(p.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${COARSE_BOX}`}
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span aria-hidden>{PLACE_CATEGORY_ICONS[p.category]}</span>
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                    {p.city ?? ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {unassigned.length > 0 && (
        <ul className="mt-3 grid gap-2" style={{ listStyle: "none", padding: 0 }}>
          {unassigned.map(({ place, reasonKey, retrying }) => (
            <li
              key={place.id}
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{
                border: "1px solid color-mix(in srgb, var(--ts-warn) 45%, transparent)",
                color: "var(--text-secondary)",
              }}
            >
              <span className="min-w-0 flex-1">
                {t("places:lists.unassigned", { name: place.name })} {t(reasonKey)}
              </span>
              <button
                type="button"
                onClick={() => onRetry(place.id)}
                disabled={retrying}
                className={`rounded-lg px-3 py-1 text-sm disabled:opacity-50 ${COARSE_BOX}`}
                style={{ border: "1px solid var(--color-border)" }}
              >
                {retrying ? t("common:buttons.saving") : t("places:lists.assignAgain")}
              </button>
              <button
                type="button"
                onClick={() => onDismiss(place.id)}
                disabled={retrying}
                className={`text-sm underline disabled:opacity-50 ${COARSE_BOX}`}
                style={{ color: "var(--text-muted)" }}
              >
                {t("places:lists.dismissUnassigned")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
